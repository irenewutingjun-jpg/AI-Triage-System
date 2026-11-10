require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

async function checkModels() {
    console.log("正在檢查您的 API Key 權限...");
    try {
        const response = await fetch(URL);
        const data = await response.json();

        if (data.error) {
            console.error("❌ API Key 錯誤或權限不足:");
            console.error(data.error);
        } else {
            console.log("✅ 連線成功！您的 Key 可以使用以下模型：");
            // 列出所有可用模型的名稱
            data.models.forEach((model) => {
                if (model.name.includes("gemini")) {
                    console.log(` - ${model.name.replace("models/", "")}`);
                }
            });
            console.log("\n請將上方其中一個名稱填入您的 analyze.js 程式中。");
        }
    } catch (err) {
        console.error("連線失敗:", err);
    }
}

checkModels();
