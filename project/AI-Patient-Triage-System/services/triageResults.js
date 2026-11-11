// 候診清單 API（routes/results.js）與 CDS 卡片（routes/cds-hooks.js）共用的查詢與整理邏輯。
// 只維護這一份：查 FHIR → 攤平 Observation → 每位病人留最新一筆並算近期最高分。
const axios = require('axios');
const { TRIAGE_SYSTEM, TRIAGE_CODE, LEGACY_SYSTEM, LEGACY_CODE } = require('./codes');

const PAGE_SIZE = 100;   // 每次向 FHIR 要幾筆
const BATCH_SIZE = 200;  // 最多抓幾筆 Observation 來整理（暫定值，需實測）
const FHIR_QUERY_TIMEOUT_MS = 15000;
// 「近期」= 該病人最新一筆之前 24 小時內（以最新一筆為基準，不是以現在為基準）
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const timeOf = (item) => (item.assessedAt ? Date.parse(item.assessedAt) : 0);

// 查 FHIR。新舊代碼一起查；分頁抓到 BATCH_SIZE 筆為止。連不上會丟錯誤，由呼叫端回 502
async function searchObservations(patientId) {
    const headers = {
        'Accept': 'application/fhir+json',
        // HAPI 會重用 60 秒內相同查詢的結果；不加的話，剛送出的病人一分鐘內不會出現
        'Cache-Control': 'no-cache'
    };
    const params = {
        code: `${TRIAGE_SYSTEM}|${TRIAGE_CODE},${LEGACY_SYSTEM}|${LEGACY_CODE}`,
        _sort: '-date',
        _count: PAGE_SIZE
    };
    if (patientId) params.subject = `Patient/${patientId}`;

    let res = await axios.get(`${process.env.FHIR_BASE_URL}/Observation`, {
        params,
        headers,
        timeout: FHIR_QUERY_TIMEOUT_MS
    });

    const observations = [];
    let truncated = false;

    while (true) {
        const entries = res.data.entry || [];
        const remaining = BATCH_SIZE - observations.length;

        for (const entry of entries.slice(0, remaining)) {
            observations.push(entry.resource);
        }
        const next = (res.data.link || []).find(link => link.relation === 'next')?.url;
        truncated = entries.length > remaining || Boolean(next);
        if (!next || observations.length >= BATCH_SIZE) break;
        res = await axios.get(next, {
            headers,
            timeout: FHIR_QUERY_TIMEOUT_MS
        });
    }
    return { observations, truncated };
}

// 把 Observation 攤平成簡單資料，前端與 CDS 都不必解析 FHIR
function flatten(obs) {
    const notes = obs.note || [];
    const summaryNote = notes.find(n => n.text?.startsWith('AI Summary:'))?.text;
    const symptomsNote = notes.find(n => n.text?.startsWith('Symptoms:'))?.text;

    // 分數規則：1-10 的整數。無法判讀就給 null 並標需人工，不能當成低風險
    const score = obs.valueQuantity?.value;
    const readable = Number.isInteger(score) && score >= 1 && score <= 10;
    const needsHuman = (obs.component || []).some(
        c => c.code?.text === 'needs_human_intervention' && c.valueBoolean === true
    );

    return {
        observationId: obs.id,
        patientId: (obs.subject?.reference || '').replace('Patient/', ''),
        urgencyScore: readable ? score : null,
        needsHuman: readable ? needsHuman : true,
        emotion: obs.code?.text || '',
        symptoms: symptomsNote
            ? symptomsNote.replace('Symptoms:', '').split(',').map(s => s.trim()).filter(Boolean)
            : [],
        summary: summaryNote ? summaryNote.replace('AI Summary:', '').trim() : '無摘要',
        assessedAt: obs.effectiveDateTime || null
    };
}

// 每位病人只留最新一筆，並加上：
//   recentMaxScore：最新一筆之前 24 小時內（含最新一筆）的最高分
//   recentPeak：拿到那個最高分的那一筆（同分取較新的）。給 CDS 卡片引用；清單 API 回傳前要拿掉
function latestPerPatient(items) {
    const groups = new Map();
    for (const it of items) {
        if (!groups.has(it.patientId)) groups.set(it.patientId, []);
        groups.get(it.patientId).push(it);
    }
    return [...groups.values()].map(list => {
        list.sort((a, b) => timeOf(b) - timeOf(a));
        const latest = list[0];
        const windowStart = timeOf(latest) - RECENT_WINDOW_MS;
        let peak = null;
        for (const x of list) {
            if (timeOf(x) < windowStart || x.urgencyScore === null) continue;
            if (!peak || x.urgencyScore > peak.urgencyScore) peak = x;   // list 新到舊，同分時保留較新的
        }
        return { ...latest, recentMaxScore: peak ? peak.urgencyScore : null, recentPeak: peak };
    });
}

module.exports = { searchObservations, flatten, latestPerPatient, timeOf };