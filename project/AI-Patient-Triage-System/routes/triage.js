const express = require('express');
const router = express.Router();
const { analyzePatientFeedback } = require('../services/aiService');
const { saveToFHIR } = require('../services/fhirService');
const { sendDoctorAlert } = require('../services/lineService');

// LINE 通知的門檻（題目：分數 >= 10 或需要人工介入）。
// CDS 卡片的門檻在 routes/cds-hooks.js（5 分 warning、8 分 critical），兩邊分開設定。
const LINE_ALERT_SCORE = 10;

// POST /api/triage/analyze  主訴 -> AI JSON -> Observation。只接受虛構病人資料。
router.post('/analyze', async (req, res) => {
    const { patientText, patientId } = req.body || {};
    if (typeof patientText !== 'string' || !patientText.trim()) {
        return res.status(400).json({ success: false, error: '請輸入主訴內容' });
    }
    // FHIR id 的規則：英數、連字號、句點，1 到 64 字
    if (typeof patientId !== 'string' || !/^[A-Za-z0-9.\-]{1,64}$/.test(patientId)) {
        return res.status(400).json({ success: false, error: '請填入有效的 Patient ID' });
    }
    if (patientText.length > 3000) {
        return res.status(400).json({ success: false, error: '內容請限制在 3000 字元以內' });
    }

    console.log(`\n--- 收到病人 (${patientId}) 回饋 ---`);

    try {
        // 1. AI 分析（失敗會丟錯誤，不會回 0 分）
        const aiResult = await analyzePatientFeedback(patientText);
        console.log("AI 分析結果:", aiResult);

        // 2. 存入 FHIR（存不進去就回 502，前端會看到錯誤，不會假裝已存檔）
        const fhirId = await saveToFHIR(aiResult, patientId);
        if (!fhirId) {
            return res.status(502).json({ success: false, error: 'FHIR 寫入失敗，未完成存檔' });
        }

        // 3. 判斷是否需要通知醫生
        let notification = { sent: false, simulated: false };
        if (aiResult.urgency_score >= LINE_ALERT_SCORE || aiResult.needs_human_intervention) {
            notification = await sendDoctorAlert(aiResult, fhirId);
        }

        // 4. 回傳給前端
        return res.json({
            success: true,
            data: aiResult,
            fhir_reference: fhirId,
            doctor_notified: Boolean(notification.sent),      // 真的送出 LINE 才是 true
            alert_simulated: Boolean(notification.simulated)  // 沒設 Token 時只在終端機印模擬通知
        });
    } catch (error) {
        console.error('[分流] 分析失敗:', error.message);
        return res.status(502).json({ success: false, error: error.message });
    }
});

module.exports = router;
