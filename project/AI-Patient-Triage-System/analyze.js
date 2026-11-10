require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analyzePatientFeedback(patientText) {
    try {
      // 使用 flash 模型速度快，適合即時分析
      // 如果您的 Key 還是只能用 gemini-pro，請將 model 改回 "gemini-pro" 並移除 generationConfig
        const model = genAI.getGenerativeModel({
            model: "gemini-3.5-flash-lite",
            generationConfig: { responseMimeType: "application/json" }
        });
        // --- 這裡是最關鍵的 Prompt 修改 ---
        const prompt = `
        你是一位門診護理師，負責候診分流（triage）。
        請根據病人的主訴內容，回傳嚴格的 JSON 格式資料，不要有多餘文字。
        
        請分析以下欄位：
        1. "chief_complaint": 一句話整理主訴（例如：胸痛合併呼吸困難）
        2. "emotion": 病人的情緒狀態（如：恐慌、焦慮、平靜、隱忍）
        3. "urgency_score": 緊急程度 1-10 的整數（1=可預約門診，5=建議當天就醫，9-10=需立即急救）
        4. "symptoms": 提到的症狀（Array of string）
        5. "red_flags": 是否出現危險徵兆，如胸痛、呼吸困難、意識改變、大量出血（Boolean）
        6. "recommended_department": 建議科別（如：急診、心臟內科、家醫科、耳鼻喉科）
        7. "summary": 一句話摘要，給醫師快速閱讀
        
        判斷原則：
        - 請依「症狀本身的嚴重度」評分，不要被病人的語氣影響。
        - 病人若輕描淡寫、說「沒事」「不想麻煩別人」，但症狀屬於危險徵兆，分數仍須拉高。
        
        病人自述內容：
        "${patientText}"
        `;    
        console.log("正在分析病人語意...");
    
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
    
        const jsonResult = JSON.parse(text);
        console.log("--------------------------------");
        console.log("分析結果:", JSON.stringify(jsonResult, null, 2));
    
        return jsonResult;
    
    } catch (error) {
        console.error("發生錯誤:", error);
    }
}

// --- 模擬病人輸入 (User Review) ---
// 案例 1：高風險（典型胸痛）
const patientInput1 = "我胸口像被石頭壓住，痛到左手臂，一直冒冷汗，喘不過氣，已經快二十分鐘了。";

// 案例 2：低風險
const patientInput2 = "喉嚨痛了兩天，有一點流鼻水，沒有發燒，想問看哪一科比較適合。";

// 案例 3：刁鑽案例（反話／壓抑）
const patientInput3 = "我沒事啦，應該只是昨天吃太飽，胸口悶悶的，一直冒冷汗，左肩有點痠，不用特地叫醫生啦，我不想麻煩大家。";

// 一次只跑一個，執行分析 (可以切換變數測試)
analyzePatientFeedback(patientInput3);

