# AI Patient Triage System（AI 候診分流）

病人輸入自己的症狀 → AI 評估急迫程度 → 寫入 FHIR → 醫師開候診清單，最需要處理的病人排在最前面；點進病人可看病歷與 CDS 建議卡片，並建立轉介。

核心主張：**AI 負責排優先順序，醫師負責決定，系統留下可追溯的紀錄。**

## 功能

- **病人端**（`/`）：輸入病人 ID 與症狀，顯示分數、情緒與給醫師的摘要。
- **醫師端**（`/doctor`）：
  - 候診清單：每位病人只顯示最新一筆，另附「近期最高分」；需人工介入者置頂。
  - 點選病人：載入病歷與 CDS 卡片（高風險、近期曾有高分、需人工介入、低分）。
  - 卡片按鈕可建立 FHIR 轉介 Task。
- **後端**：呼叫 Gemini 評分、寫入／查詢 FHIR、候診清單 API、CDS Hooks 服務、LINE 通知（可選）。
- **安全設計**：AI 或 FHIR 失敗時回錯誤、不給預設分數；清單把「沒資料」與「出錯」分開；分數不合規則標為無法判讀並要求人工核對。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `project/AI-Patient-Triage-System/` | 後端（Node.js、Express） |
| `project/Client/` | 前端（Vue 3、Vite） |
| `design/` | 架構圖、時序圖、候診清單設計說明（`waiting-list.md`）、API 規格（`triage-results-api.json`） |
| `record/readme.md` | AI 協作紀錄 |
| `screenshot/` | 截圖 |

`analyze.js`、`check.js` 是早期作業的獨立測試腳本（單獨測 AI 分析與檢查可用模型），不屬於伺服器流程。

## 執行方式

需要 Node.js 20.19 以上（或 22.12 以上），這是前端 Vite 7 的要求。

### 1. 後端

```
cd project/AI-Patient-Triage-System
npm install
```

把 `.env.example` 複製成 `.env`，填入 `GEMINI_API_KEY`（其他設定見下表）。然後：

```
npm run dev
```

看到 `Server is running on http://localhost:3000` 即成功。

| 環境變數 | 說明 |
|---|---|
| `PORT` | 後端埠號，預設 3000（前端寫死呼叫 3000，請勿更改） |
| `GEMINI_API_KEY` | Gemini API 金鑰（必填） |
| `FHIR_BASE_URL` | FHIR 伺服器，預設 `https://hapi.fhir.org/baseR4` |
| `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_DOCTOR_USER_ID` | 選填；不填時 LINE 通知只在終端機印出模擬訊息 |

### 2. 前端

```
cd project/Client
npm install
npm run dev
```

開啟 `http://localhost:5173`（病人端）與 `http://localhost:5173/doctor`（醫師端）。

## 使用前須知

- **病人必須先存在於 FHIR**：病人端用不存在的 ID 送出會寫入失敗（HAPI-1094）。FHIR 伺服器是公開測試站，資料可能被清除；若找不到病人，請先建立（用 `PUT`，把 ID 寫在網址）：

  ```
  PUT {FHIR_BASE_URL}/Patient/patient-tw-001
  Content-Type: application/fhir+json

  { "resourceType": "Patient", "id": "patient-tw-001", "name": [{ "text": "測試病人" }] }
  ```

  用 `POST` 建立時 FHIR 會自己換 ID，不能指定。
- 前端的 FHIR 位址（`DoctorView.vue` 內的 `FHIR_SERVER_URL`）要與後端 `.env` 的 `FHIR_BASE_URL` 是同一台。

## API

| 方法與路徑 | 說明 |
|---|---|
| `POST /api/triage/analyze` | 送出 `patientId`、`patientText`，回傳 AI 評估並寫入 FHIR |
| `GET /api/triage/results` | 候診清單；參數 `patientId`、`minScore`、`limit`、`sort`，規格見 `design/triage-results-api.json` |
| `GET /cds-services` | CDS Hooks Discovery |
| `POST /cds-services/patient-triage-service` | patient-view 服務，回傳 CDS 卡片 |

## 文件

- 設計說明、決定紀錄、驗證紀錄：`design/waiting-list.md`
- 架構與流程圖：`design/architecture.md`、`design/process.md`、`design/process2.md`
- AI 協作紀錄：`record/readme.md`
- 第一階段原始規格（歷史文件）：`design/spec_step1.txt`

## 已知限制

- 沒有「已處置」狀態，處理過的病人不會離開清單。
- AI 每次只看單一句話，含蓄的說法可能被低估；目前靠「近期最高分」補救。
- 病人端不能建立新病人。
- 「近期」固定為最新一筆之前 24 小時；一次最多向 FHIR 抓 200 筆、清單最多顯示 50 位。
- 沒有登入機制，不記錄是哪位醫師操作。