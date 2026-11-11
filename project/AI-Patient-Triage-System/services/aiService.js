require('dotenv').config();
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 回傳 JSON 的 Schema：urgency_score 規定是整數。
// 換情境要加欄位（例如 medication、side_effects）時，Prompt 和這張 Schema 要一起改，Schema 沒列的欄位模型不會回。
const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        emotion: { type: SchemaType.STRING, description: "核心情緒" },
        urgency_score: { type: SchemaType.INTEGER, description: "急迫性分數，1 到 10 的整數" },
        symptoms: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "生理症狀" },
        needs_human_intervention: { type: SchemaType.BOOLEAN, description: "是否需人工介入" },
        summary: { type: SchemaType.STRING, description: "給醫師的簡短摘要" }
    },
    required: ["emotion", "urgency_score", "symptoms", "needs_human_intervention", "summary"]
};

// 檢查模型回的 JSON 合不合規格：不合格回傳原因，合格回傳 null
function validate(parsed) {
    if (!parsed || typeof parsed !== 'object') return '不是 JSON 物件';
    const s = parsed.urgency_score;
    if (!Number.isInteger(s) || s < 1 || s > 10) return `urgency_score 不是 1-10 的整數（收到 ${JSON.stringify(s)}）`;
    if (typeof parsed.needs_human_intervention !== 'boolean') return 'needs_human_intervention 不是布林值';
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) return 'summary 是空的';
    if (
        !Array.isArray(parsed.symptoms) ||
        !parsed.symptoms.every(s => typeof s === 'string' && s.trim().length > 0)
    ) {
        return 'symptoms 必須是由非空白字串組成的陣列';
    }
    return null;
}

async function analyzePatientFeedback(patientText) {
    const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite", // 若無此模型，先用 A3-7 的 check.js 看可用清單
        generationConfig: { responseMimeType: "application/json", responseSchema }
    });

    const prompt = `
    你是一位門診護理師，負責候診分流（triage）。
    請根據病人的主訴內容，回傳嚴格的 JSON 格式資料，不要有多餘文字。
    
    需分析欄位：
    1. "emotion": 病人的情緒狀態（字串，如：恐慌、焦慮、平靜、隱忍）。
    2. "urgency_score": 緊急程度 1-10 的整數（1=可預約門診，5=建議當天就醫，9-10=需立即急救）。
    3. "symptoms": 提到的症狀（字串陣列）。
    4. "needs_human_intervention": 是否出現危險徵兆或需要醫護立即處理，如胸痛、呼吸困難、意識改變、大量出血（布林值）。
    5. "summary": 給醫師的一句話簡短摘要（字串）。
    
    判斷原則：
    - 請依「症狀本身的嚴重度」評分，不要被病人的語氣影響。
    - 病人若輕描淡寫、說「沒事」「不想麻煩別人」，但症狀屬於危險徵兆，分數仍須拉高。    
    
    
    病人自述： "${patientText}"
    `;
    // 最多試兩次：第一次不合規格（例如回小數、缺欄位）或呼叫失敗就重試一次，再失敗就丟錯誤。
    // 失敗不可以換成 0 分或低風險存進 FHIR，由 routes/triage.js 回錯誤給前端。
    let lastReason = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const parsed = JSON.parse(response.text());
            const reason = validate(parsed);
            if (reason) {
                lastReason = reason;
                console.warn(`[AI] 第 ${attempt} 次回傳不合規格：${reason}`);
                continue;
            }
            // 換情境時若用 side_effects 取代 symptoms，這裡轉回共用的 symptoms 給 fhirService 用
            const symptoms = parsed.symptoms ?? parsed.side_effects ?? [];
            parsed.symptoms = Array.isArray(symptoms) ? symptoms.map(String) : [];
            parsed.emotion = typeof parsed.emotion === 'string' ? parsed.emotion : '未標示';
            return parsed;
        } catch (error) {
            const status = error?.status;
            lastReason = Number.isInteger(status)
                ? `Gemini 呼叫失敗（HTTP ${status}）`
                : 'Gemini 呼叫失敗，未取得 HTTP 狀態碼';
            console.error(`[AI] 第 ${attempt} 次呼叫失敗`, lastReason);        
        }
    }
    throw new Error(`AI 分析失敗（${lastReason}），請稍後重試並由人員確認`);
}

module.exports = { analyzePatientFeedback };
