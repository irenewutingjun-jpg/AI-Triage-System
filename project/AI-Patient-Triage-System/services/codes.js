// 代碼的單一來源：寫入端與讀取端都從這裡拿，避免兩邊不一致
module.exports = {
  // 新代碼（示意網址，不是正式發布的 CodeSystem）
    TRIAGE_SYSTEM: "http://example.org/CodeSystem/ai-triage",
    TRIAGE_CODE: "urgency-score",
    // 舊代碼（舊資料仍用這個查）
    LEGACY_SYSTEM: "http://loinc.org",
    LEGACY_CODE: "80615-8",
};