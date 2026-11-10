const express = require('express');
const { searchObservations, flatten, latestPerPatient, timeOf } = require('../services/triageResults');
require('dotenv').config();

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 函式 1：檢查參數。回傳 { error } 或 { patientId, minScore, limit, sort }
function parseQuery(query) {
    const { patientId, minScore, limit, sort } = query;

    // FHIR id 的規則：英數、連字號、句點，1 到 64 字（與 routes/triage.js 相同）
    if (patientId !== undefined && !/^[A-Za-z0-9.\-]{1,64}$/.test(String(patientId))) {
        return { error: 'patientId 格式不正確' };
    }

    let min = null;
    if (minScore !== undefined) {
        if (!/^\d+$/.test(String(minScore)) || Number(minScore) < 1 || Number(minScore) > 10) {
            return { error: 'minScore 必須是 1 到 10 的整數' };
        }
        min = Number(minScore);
    }

    let n = DEFAULT_LIMIT;
    if (limit !== undefined) {
        if (!/^\d+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
            return { error: `limit 必須是 1 到 ${MAX_LIMIT} 的整數` };
        }
        n = Number(limit);
    }

    const sortBy = sort === undefined ? 'date' : String(sort);
    if (sortBy !== 'date' && sortBy !== 'score') {
        return { error: 'sort 只能是 date 或 score' };
    }

    return { patientId: patientId === undefined ? null : String(patientId), minScore: min, limit: n, sort: sortBy };
}

// 函式 2：排序。date = 時間新到舊；score = 最新一筆需人工者在前，其次近期最高分高到低，再其次時間新到舊
function sortItems(items, sortBy) {
    if (sortBy === 'score') {
        return items.sort((a, b) =>
            (Number(b.needsHuman) - Number(a.needsHuman)) ||
            ((b.recentMaxScore ?? 0) - (a.recentMaxScore ?? 0)) ||
            (timeOf(b) - timeOf(a)));
    }
    return items.sort((a, b) => timeOf(b) - timeOf(a));
}

router.get('/', async (req, res) => {
    const q = parseQuery(req.query);
    if (q.error) {
        return res.status(400).json({ success: false, error: q.error });
    }

    try {
        const { observations, truncated } = await searchObservations(q.patientId);

        let items = latestPerPatient(observations.map(flatten));
        // minScore 比的是「近期最高分」，這樣「最新一筆低分、但剛剛有高分」的病人不會被濾掉；無法判讀的一律保留
        if (q.minScore !== null) {
            items = items.filter(i =>
                i.urgencyScore === null ||
                i.recentMaxScore === null ||
                i.recentMaxScore >= q.minScore
            );
        }
        const outputLimited = items.length > q.limit;
        items = sortItems(items, q.sort).slice(0, q.limit);

        // recentPeak 只給 CDS 卡片用，不屬於清單 API 的回傳欄位
        items = items.map(({ recentPeak, ...item }) => item);

        // 查不到資料是 200 加空陣列；FHIR 出錯才走下面的 502
        return res.json({
            success: true,
            count: items.length,
            truncated: truncated || outputLimited,
            items
        });
    } catch (error) {
        console.error('[Results] FHIR 查詢失敗:', error.message);
        return res.status(502).json({ success: false, error: 'FHIR 查詢失敗，無法取得候診清單' });
    }
});

module.exports = router;