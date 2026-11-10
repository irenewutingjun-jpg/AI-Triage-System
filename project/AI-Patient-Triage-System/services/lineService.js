const axios = require('axios');
require('dotenv').config();

// 回傳 { sent, simulated }：sent 只有真的送出 LINE 才是 true；沒設 Token 時 simulated 是 true
async function sendDoctorAlert(analysisResult, fhirId) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const doctorUserId = process.env.LINE_DOCTOR_USER_ID; // 收通知的醫師 userId（實際應用從資料庫讀）

    // 如果沒有 Token，只印出 Log (方便測試)
    if (!token) {
        console.log("⚠️ [模擬 LINE 通知]：分數 >= 10 或需人工介入，請醫師查看。分數：", analysisResult.urgency_score, "FHIR ID：", fhirId);
        return { sent: false, simulated: true };
    }
    // 有 Token 但沒說要送給誰：不能假裝送出
    if (!doctorUserId) {
        console.error("[LINE] 有 Token 但沒設 LINE_DOCTOR_USER_ID，通知沒有送出");
        return { sent: false, simulated: false };
    }

    const message = {
        to: doctorUserId,
        messages: [{
            type: "flex",
            altText: "緊急病人通知",
            contents: {
                type: "bubble",
                header: {
                    type: "box",
                    layout: "vertical",
                    contents: [{ type: "text", text: "🚨 高風險警報", weight: "bold", color: "#FF0000" }]
                },
                body: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                        { type: "text", text: `急迫性分數: ${analysisResult.urgency_score}/10` },
                        { type: "text", text: `摘要: ${analysisResult.summary}`, wrap: true }
                    ]
                }
            }
        }]
    };

    try {
        await axios.post('https://api.line.me/v2/bot/message/push', message, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log("[LINE] 通知已發送");
        return { sent: true, simulated: false };
    } catch (error) {
        console.error("[LINE] 發送失敗:", error.response?.data || error.message);
        return { sent: false, simulated: false };
    }
}

module.exports = { sendDoctorAlert };
