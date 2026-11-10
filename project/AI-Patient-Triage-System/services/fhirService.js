const { TRIAGE_SYSTEM, TRIAGE_CODE } = require('./codes');
const axios = require('axios');
require('dotenv').config();

async function saveToFHIR(analysisResult, patientId) {
    const fhirUrl = process.env.FHIR_BASE_URL;

    const observation = {
        resourceType: "Observation",
        status: "final",
        // 沿用課堂指定的代碼，讓寫入端和讀取端（routes/cds-hooks.js）查得到同一筆。
        // LOINC 80615-8 的官方語意是「Recommended follow-up [Identifier] Narrative」，不是急迫性分數；
        // 這裡只是教學相容，期末專題要換成自訂 CodeSystem（見作業說明第 10 節）。
        code: {
            coding: [{ system: TRIAGE_SYSTEM, code: TRIAGE_CODE, display: "AI triage urgency score" }],
            text: analysisResult.emotion
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date().toISOString(),
        valueQuantity: {
            value: analysisResult.urgency_score,
            unit: "score",
            system: "http://unitsofmeasure.org",
            code: "{score}"
        },
        // 「需不需要人工介入」也要存進去，醫師端才讀得到；只存分數的話，3 分但 AI 說要有人處理的病人會被當成沒事
        component: [
            {
                code: { text: "needs_human_intervention" },
                valueBoolean: Boolean(analysisResult.needs_human_intervention)
            }
        ],
        note: [
            { text: `AI Summary: ${analysisResult.summary}` },
            { text: `Symptoms: ${analysisResult.symptoms.join(', ')}` }
        ]
    };

    try {
        const response = await axios.post(`${fhirUrl}/Observation`, observation, {
            headers: { 'Content-Type': 'application/fhir+json', 'Accept': 'application/fhir+json' }
        });
        console.log(`[FHIR] 資料已存檔，ID: ${response.data.id}`);
        return response.data.id;
    } catch (error) {
        if (error.response) {
            // 伺服器有回應，但狀態碼不在 2xx 範圍內
            console.error("[FHIR] 上傳失敗 - 伺服器回應:");
            console.error("狀態碼 (Status):", error.response.status);

            // 這是最關鍵的部分，FHIR 的錯誤細節都在這裡
            // 使用 JSON.stringify 讓輸出的物件排版易讀
            console.error("錯誤內容 (Body):", JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            // 請求已發出，但沒有收到回應 (例如網路斷線、伺服器掛掉連不上)
            console.error("[FHIR] 上傳失敗 - 無回應 (Network Error):", error.message);
        } else {
            // 設定請求時發生錯誤
            console.error("[FHIR] 上傳失敗 - 請求設定錯誤:", error.message);
        }
        return null;
    }
}

module.exports = { saveToFHIR };
