const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchObservations, flatten, latestPerPatient } = require('../services/triageResults');
const { TRIAGE_SYSTEM, TRIAGE_CODE } = require('../services/codes');
require('dotenv').config();

const CDS_WARNING_SCORE = 5;
const CDS_CRITICAL_SCORE = 8;

// 把攤平後的資料還原成卡片原本使用的兩行文字
const summaryLine = (item) => (item.summary === '無摘要' ? '無摘要' : `AI Summary: ${item.summary}`);
const symptomsLine = (item) => (item.symptoms.length ? `Symptoms: ${item.symptoms.join(', ')}` : '');

// 卡片上顯示的時間（台灣時區，UTC+8、沒有夏令時間）。
const formatTaipei = (iso) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return '時間不明';
    const d = new Date(t + 8 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

// 建立「轉介」建議：只產生範本，醫師按下按鈕後才由前端寫進 FHIR
function buildReferralSuggestion(patientId, observationId, urgencyScore, summaryText) {
    return {
        label: '建立轉介 Task',
        uuid: crypto.randomUUID(),
        isRecommended: true,
        actions: [{
            type: 'create',
            description: '在 FHIR Server 建立一筆轉介 Task，追蹤此病人的後續處置',
            resource: {
                resourceType: 'Task',
                status: 'requested',
                intent: 'order',
                priority: urgencyScore >= CDS_CRITICAL_SCORE ? 'urgent' : 'routine',
                description: `AI 分流轉介（分數 ${urgencyScore}）：${summaryText}`,
                for: { reference: `Patient/${patientId}` },
                focus: { reference: `Observation/${observationId}` }
            }
        }]
    };
}

// CDS Hooks Discovery Endpoint
router.get('/', (req, res) => {
    res.json({
        services: [
            {
                hook: "patient-view", // 觸發時機：通常 triage 評估會在進入病歷畫面時觸發
                id: "patient-triage-service", // < 重要：這裡必須與下方 POST 的路徑一致 >
                title: "AI 智能檢傷與初步評估系統",
                description: "分析病患症狀與情緒，自動生成檢傷建議與處置優先級別。",
                prefetch: {
                    patient: "Patient/{{context.patientId}}" // 若需要 EHR 預先抓取病人資料,可寫在這裡
                }
            }
        ]
    });
});


// Service Endpoint: patient-view
router.post('/patient-triage-service', async (req, res) => {
    const context = req.body?.context || {};
    const patientId = context.patientId;

    if (!patientId) {
        return res.status(400).json({ error: "Missing patientId" });
    }

    console.log(`[CDS Hook] 醫師正在查看病人: ${patientId}`);

    let cards = [];

    try {
        // 1. 與候診清單共用同一套查詢與整理（新舊代碼都查、不用快取、每人留最新一筆並算近期最高分）
        const { observations } = await searchObservations(patientId);
        const items = latestPerPatient(observations.map(flatten));

        if (items.length > 0) {
            const latest = items[0];

            // 2. 分數規則：1-10 的整數。不合規則就無法判讀，不能當成低風險
            const urgencyScore = latest.urgencyScore;
            if (urgencyScore === null) {
                console.error('[CDS Hook] 最新 Observation 缺少有效的 1-10 整數分數');
                return res.json({ cards: [{
                    summary: '⚠️ 最新 AI 評估資料無法判讀',
                    indicator: 'warning',
                    detail: '請人工核對原始資料，不得視為低風險。',
                    source: { label: 'AI Triage System' }
                }] });
            }
            const needsHuman = latest.needsHuman;
            const recentMax = latest.recentMaxScore;   // 最新一筆之前 24 小時內的最高分（含最新一筆）
            const peak = latest.recentPeak;            // 拿到近期最高分的那一筆

            console.log(`[CDS Hook] 找到最新評估，分數: ${urgencyScore}，近期最高: ${recentMax}，需人工介入: ${needsHuman}`);

            const referral = buildReferralSuggestion(patientId, latest.observationId, urgencyScore, summaryLine(latest));

            // 3. 判斷卡片種類
            if (urgencyScore >= CDS_WARNING_SCORE) {
                // 最新一筆已經是高分；若近期曾更高，多提示一行（卡片等級仍依最新一筆）
                const recentNote = recentMax > urgencyScore
                    ? `近期 24 小時內最高曾達 ${recentMax} 分（${formatTaipei(peak.assessedAt)}）\n`
                    : '';
                cards.push({
                    summary: `🚨 高風險警示 (分數: ${urgencyScore})`,
                    indicator: urgencyScore >= CDS_CRITICAL_SCORE ? "critical" : "warning",
                    suggestions: [referral],
                    source: {
                        label: "AI Triage System",
                        topic: {
                            system: TRIAGE_SYSTEM,
                            code: TRIAGE_CODE
                        }
                    },
                    detail: `${summaryLine(latest)}\n${symptomsLine(latest)}\n${recentNote}(資料來源: 病人最新自述；AI 分數僅供參考，由醫護人員確認)`
                });
            } else if (recentMax >= CDS_WARNING_SCORE) {
                // 最新一筆分數低，但近期剛有高分：不能只因為最新一句比較輕就顯示成沒事
                const peakReferral = buildReferralSuggestion(patientId, peak.observationId, peak.urgencyScore, summaryLine(peak));
                cards.push({
                    summary: `⚠️ 近期曾有高分評估（最新 ${urgencyScore}，近期最高 ${recentMax}）`,
                    indicator: "warning",
                    suggestions: [peakReferral],
                    source: { label: "AI Triage System" },
                    detail:
                        `近期 24 小時內曾有 ${recentMax} 分評估（${formatTaipei(peak.assessedAt)}）：${peak.summary}\n` +
                        `最新一筆（${urgencyScore} 分，${formatTaipei(latest.assessedAt)}）：${latest.summary}\n` +
                        (needsHuman ? 'AI 也標記最新一筆需要人工介入\n' : '') +
                        `(最新一筆分數較低，不代表風險已解除；AI 分數僅供參考，由醫護人員確認)`
                });
            } else if (needsHuman) {
                // 分數不高，但 AI 判斷需要有人處理（例如想自行停藥、在問用藥問題）：不能顯示成沒事
                cards.push({
                    summary: `⚠️ AI 建議人工介入 (分數: ${urgencyScore})`,
                    indicator: "warning",
                    suggestions: [referral],
                    source: { label: "AI Triage System" },
                    detail: `${summaryLine(latest)}\n${symptomsLine(latest)}\n(分數不高，但 AI 標記需要人工介入；由醫護人員確認)`
                });
            } else {
                // 低分也跳一張卡，但低分不等於沒風險，所以不寫「穩定」
                cards.push({
                    summary: `✅ AI 暫無高優先提示 (分數: ${urgencyScore})`,
                    indicator: "info",
                    detail: `${summaryLine(latest)}\n低分不代表已排除風險，仍需由醫護確認。`,
                    source: { label: "AI Triage System" }
                });
            }
        } else {
            // 查無資料也要有一張卡，醫師畫面才不會一片空白像是「沒事」
            console.log("[CDS Hook] 查無該病人的 AI 評估資料");
            cards.push({
                summary: 'ℹ️ 尚無 AI 分流紀錄',
                indicator: 'info',
                detail: '目前查無資料，不能據此判斷病人狀況。',
                source: { label: 'AI Triage System' }
            });
        }

    } catch (error) {
        // FHIR 連不上或查詢出錯：回 502，醫師頁會顯示錯誤，不能顯示成沒事
        console.error("FHIR 查詢錯誤:", error.message);
        return res.status(502).json({ error: 'FHIR 查詢失敗，無法產生分流建議' });
    }

    // 回傳 CDS Cards JSON
    res.json({ cards });
});
// 🌟 關鍵就在這裡：把設定好的 router 導出，讓主程式可以使用
module.exports = router;