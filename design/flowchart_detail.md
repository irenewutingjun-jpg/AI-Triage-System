```mermaid

flowchart LR
  S(["開始"])
  I[/"輸入 patientId、patientText"/]
  V1{"輸入合法？"}
  E1(["回 400：輸入不合法"])
  B["組合 Prompt"]
  G["呼叫 Gemini API"]
  V3{"成功且格式正確？"}
  E3(["回 502：評估失敗"])
  O["轉成 Observation"]
  F["寫入 FHIR Server"]
  V4{"FHIR 回 201？"}
  E4(["回 502：儲存失敗"])
  R[/"回 200：分數與 id"/]
  X(["結束"])
  S --> I
  I --> V1
  V1 -->|是| B
  V1 -->|否| E1
  B --> G
  G -->|JSON| V3
  V3 -->|是| O
  V3 -->|否| E3
  O --> F
  F --> V4
  V4 -->|是| R
  V4 -->|否| E4
  R --> X

```