<template>
  <div class="ehr-container">
    <header class="ehr-header">
      <div class="header-content">
        <h1>🩺 醫師看診視圖 (EHR Dashboard)</h1>
        <p>臨床決策支援系統 (CDS Hooks) 整合展示</p>
      </div>
    </header>

    <main class="ehr-main">
      <!-- 候診清單：需人工介入的排最前面；點一位病人，下方會載入病歷與 CDS 卡片 -->
      <div class="waiting-list">
        <div class="wl-header">
          <h2>🧾 候診清單</h2>
          <div class="wl-actions">
            <span v-if="lastUpdated" class="wl-updated">最後更新：{{ formatTime(lastUpdated) }}</span>
            <button class="wl-refresh" @click="loadWaitingList" :disabled="listLoading">
              {{ listLoading ? '更新中...' : '重新整理' }}
            </button>
          </div>
        </div>

        <div v-if="listError" class="error-message">{{ listError }}</div>
        <div v-if="listTruncated" class="wl-warning">
          ⚠ 清單可能不完整：資料量超過一次可整理的上限，有病人可能沒有列出。
        </div>

        <div v-if="listLoading && !waitingList.length" class="wl-empty">載入候診清單中...</div>
        <div v-else-if="!listLoading && !listError && !waitingList.length" class="wl-empty">
          目前沒有候診病人
        </div>

        <div
          v-for="item in waitingList"
          :key="item.patientId"
          class="wl-row"
          :class="{ 'needs-human': item.needsHuman, selected: patientData && patientData.id === item.patientId }"
          role="button"
          tabindex="0"
          @click="selectPatient(item.patientId)"
          @keyup.enter="selectPatient(item.patientId)"
        >
          <div class="wl-top">
            <strong class="wl-id">{{ item.patientId }}</strong>
            <span class="badge" :class="scoreClass(item.urgencyScore)">
              {{ item.urgencyScore === null ? '分數無法判讀' : '急迫 ' + item.urgencyScore }}
            </span>
            <span v-if="item.needsHuman" class="badge badge-human">需人工介入</span>
            <span v-if="hasHigherRecent(item)" class="badge badge-recent">⚠ 近期最高 {{ item.recentMaxScore }}</span>
          </div>
          <div class="wl-symptoms">{{ item.symptoms.length ? item.symptoms.join('、') : '未記錄症狀' }}</div>
          <div class="wl-summary">{{ item.summary }}</div>
          <div class="wl-time">{{ formatTime(item.assessedAt) }}</div>
        </div>
      </div>

      <div class="patient-selection" ref="detailEl">
        <label for="patient-id">病人 ID（跟病人頁共用）：</label>
        <input 
          id="patient-id" 
          v-model="patientId" 
          type="text" 
          placeholder="例如: patient-tw-lily01" 
          @keyup.enter="getPatientRecord(patientId)"
        />
        <button @click="getPatientRecord(patientId)" :disabled="loading">
          {{ loading ? '讀取中...' : '讀取病人病歷' }}
        </button>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div v-if="patientData" class="patient-record">
        <h2>📄 病人基本資料</h2>
        <div class="record-details">
          <p><strong>FHIR ID：</strong> {{ patientData.id }}</p>
          <p><strong>姓名：</strong> {{ patientData.name }}</p>
          <p><strong>性別：</strong> {{ patientData.gender }}</p>
          <p><strong>出生日期：</strong> {{ patientData.birthDate }}</p>
        </div>
      </div>

      <div v-if="cdsCards.length > 0" class="cds-cards">
        <h2>💡 臨床決策建議 (CDS Cards)</h2>
        <div 
          v-for="(card, index) in cdsCards" 
          :key="index" 
          class="card" 
          :class="card.indicator"
        >
          <h3>{{ card.summary }}</h3>
          <p>{{ card.detail }}</p>

          <!-- 延伸 2：卡片建議（醫師按下才建立 Task） -->
          <div v-if="card.suggestions?.length" class="suggestions">
            <div v-for="s in card.suggestions" :key="s.uuid" class="suggestion">
              <button
                class="action-btn"
                :disabled="taskStatus[s.uuid]?.loading || !!taskStatus[s.uuid]?.id"
                @click="applySuggestion(s)"
              >
                {{ taskStatus[s.uuid]?.loading ? '建立中...' : taskStatus[s.uuid]?.id ? '已建立' : s.label }}
              </button>
              <span v-if="taskStatus[s.uuid]?.id" class="task-ok">✅ Task 已建立（ID: {{ taskStatus[s.uuid].id }}）</span>
              <span v-if="taskStatus[s.uuid]?.error" class="task-error">❌ {{ taskStatus[s.uuid].error }}</span>
            </div>
          </div>

          <a v-if="card.source && card.source.url" :href="card.source.url" target="_blank" class="source-link">
            參考資料: {{ card.source.label }}
          </a>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { usePatientId } from '../composables/usePatientId';

// 狀態管理
const patientId = usePatientId();   // 跟病人頁共用同一個 ID，記在 localStorage（見 composables/usePatientId.js） 
const patientData = ref(null);
const cdsCards = ref([]);
const availableServices = ref([]);
const loading = ref(false);
const error = ref(null);
const taskStatus = ref({});   // 每個建議按鈕的狀態：{ loading, id, error }

// 候診清單的狀態
const waitingList = ref([]);
const listLoading = ref(false);
const listError = ref(null);
const listTruncated = ref(false);   // 後端回報「清單可能不完整」
const lastUpdated = ref(null);
const detailEl = ref(null);         // 病人明細區塊，點選病人後捲到這裡

// 你的 CDS Hooks Server 網址 (請依據你的專案設定修改)
const CDS_SERVER_URL = 'http://localhost:3000/cds-services';
// 候診清單 API（依急迫程度排序，每位病人只回最新一筆）
const RESULTS_URL = 'http://localhost:3000/api/triage/results';
// 課程指定的 FHIR 測試伺服器
const FHIR_SERVER_URL = 'https://hapi.fhir.org/baseR4';   // 要跟後端 .env 的 FHIR_BASE_URL 同一台（原本 https://hapi.fhir.tw/fhir，2026-10-17 該台 503 暫改）

// ==========================================
// 1. 系統初始化階段 (Discovery GET)
// ==========================================
onMounted(async () => {
  try {
    const response = await fetch(CDS_SERVER_URL);
    if (!response.ok) throw new Error('無法取得 CDS 服務清單');
    
    const data = await response.json();
    availableServices.value = data.services || [];
    console.log('✅ 成功載入 CDS 服務清單:', availableServices.value);
  } catch (err) {
    console.error('Discovery GET 失敗:', err);
    error.value = '無法連接到 CDS Server，請確認後端是否已啟動。';
  }

  // 清單放在 Discovery 之後載入，點選病人時 CDS 服務清單一定已經就緒
  await loadWaitingList();
});

// ==========================================
// 2. 使用者操作階段 (觸發 Service POST)
// ==========================================
const getPatientRecord = async (id) => {
  if (!id) {
    error.value = '請輸入病人 ID';
    return;
  }
  
  loading.value = true;
  error.value = null;
  patientData.value = null;
  cdsCards.value = [];
  taskStatus.value = {};

  try {
    // [步驟 A]：真實去 FHIR Server 取得病人資料
    console.log(`正在向 FHIR Server 請求病人資料: ${FHIR_SERVER_URL}/Patient/${id}`);
    const fhirResponse = await fetch(`${FHIR_SERVER_URL}/Patient/${id}`);
    
    if (!fhirResponse.ok) {
      if (fhirResponse.status === 404) throw new Error('在 FHIR Server 上找不到此 ID 的病人');
      throw new Error(`無法取得病人資料，HTTP 狀態碼: ${fhirResponse.status}`);
    }
    
    const fhirPatient = await fhirResponse.json();

    // 解析 FHIR 格式的資料，對應到畫面要顯示的結構
    const patientNameData = fhirPatient.name?.[0];
    const patientName = patientNameData?.text || 
                        `${patientNameData?.family || ''} ${patientNameData?.given?.join(' ') || ''}`.trim() || 
                        '無姓名資料';

    const genderMap = { 'male': '男', 'female': '女', 'other': '其他', 'unknown': '未知' };

    patientData.value = {
      id: fhirPatient.id,
      name: patientName,
      gender: genderMap[fhirPatient.gender] || fhirPatient.gender || '無性別資料',
      birthDate: fhirPatient.birthDate || '無生日紀錄'
    };

    // [步驟 B]：觸發 CDS Hooks (patient-view)
    const patientViewServices = availableServices.value.filter(s => s.hook === 'patient-view');
    
    if (patientViewServices.length > 0) {
      const requestBody = {
        hook: 'patient-view',
        hookInstance: crypto.randomUUID(),
        context: {
          userId: 'Practitioner/example-doctor', 
          patientId: id, 
        },
        // 透過 prefetch 將剛查到的 FHIR 病人資料帶給 CDS 服務
        prefetch: {
          patientToGreet: fhirPatient
        }
      };

      for (const service of patientViewServices) {
        const serviceUrl = `${CDS_SERVER_URL}/${service.id}`;

        const cdsResponse = await fetch(serviceUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (cdsResponse.ok) {
          const result = await cdsResponse.json();
          if (result && result.cards) {
            cdsCards.value.push(...result.cards);
          }
        } else {
          console.warn(`呼叫 CDS 服務 ${service.id} 失敗:`, cdsResponse.status);
          error.value = `CDS 服務查詢失敗（HTTP ${cdsResponse.status}），無法確認分流結果，不能當成沒事。`;
        }
      }
    } else {
      console.log('目前沒有註冊 patient-view 的 CDS 服務');
    }

  } catch (err) {
    console.error('取得病歷或呼叫 CDS 發生錯誤:', err);
    error.value = '發生錯誤：' + err.message;
  } finally {
    loading.value = false;
  }
};

// ==========================================
// 3. 醫師按下建議按鈕：把卡片裡的 Task 範本真正寫進 FHIR Server
// ==========================================
const applySuggestion = async (suggestion) => {
  const key = suggestion.uuid;
  taskStatus.value[key] = { loading: true };
  try {
    for (const action of suggestion.actions || []) {
      if (action.type !== 'create' || !action.resource) continue;
      // 建立時間在「按下按鈕當下」才補上，比產生卡片時更貼近真實下單時間
      const resource = { ...action.resource, authoredOn: new Date().toISOString() };
      const res = await fetch(`${FHIR_SERVER_URL}/${resource.resourceType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/fhir+json', 'Accept': 'application/fhir+json' },
        body: JSON.stringify(resource)
      });
      if (!res.ok) throw new Error(`FHIR 建立失敗（HTTP ${res.status}）`);
      const created = await res.json();
      taskStatus.value[key] = { id: created.id };
    }
    if (!taskStatus.value[key].id) {
      taskStatus.value[key] = { error: '沒有可執行的動作' };
    }
  } catch (err) {
    taskStatus.value[key] = { error: err.message };
  }
};
// ==========================================
// 4. 候診清單
// ==========================================
const loadWaitingList = async () => {
  listLoading.value = true;
  listError.value = null;
  try {
    const res = await fetch(`${RESULTS_URL}?sort=score&limit=50`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.success !== true) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    waitingList.value = data.items;
    listTruncated.value = data.truncated === true;
    lastUpdated.value = new Date();
  } catch (err) {
    console.error('取得候診清單失敗:', err);
    // 失敗時清空清單並顯示錯誤，不能留著舊資料或顯示成「沒有病人」
    waitingList.value = [];
    listTruncated.value = false;
    // fetch 連不上後端時瀏覽器丟的是 TypeError（訊息是英文的 Failed to fetch 之類），換成看得懂的說法
    const reason = err instanceof TypeError ? '無法連線到後端伺服器' : err.message;
    listError.value = '無法取得候診清單，不能當成沒有病人：' + reason;
  } finally {
    listLoading.value = false;
  }
};

// 點清單中的病人：代填 ID、載入病歷與 CDS 卡片，再捲到明細區塊
const selectPatient = async (id) => {
  if (loading.value) return;
  patientId.value = id;
  await getPatientRecord(id);
  detailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// 分數顏色：>= 8 紅、5–7 橘、其餘綠；無法判讀用灰
const scoreClass = (score) => {
  if (score === null || score === undefined) return 'score-unknown';
  if (score >= 8) return 'score-high';
  if (score >= 5) return 'score-mid';
  return 'score-low';
};

// 最新一筆分數低、但近期出現過更高分：要提醒醫師，避免漏看
const hasHigherRecent = (item) =>
  item.urgencyScore !== null && item.recentMaxScore !== null && item.recentMaxScore > item.urgencyScore;

const formatTime = (value) => {
  if (!value) return '無時間紀錄';
  const d = new Date(value);
  return isNaN(d) ? '無時間紀錄' : d.toLocaleString('zh-TW', { hour12: false });
};
</script>

<style scoped>
.ehr-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.ehr-header {
  background-color: #f4f6f8;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  border-left: 5px solid #2c3e50;
}

.ehr-header h1 {
  margin: 0 0 10px 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.patient-selection {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.patient-selection input {
  padding: 10px;
  margin: 0 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  width: 200px;
}

.patient-selection button {
  padding: 10px 20px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.patient-selection button:disabled {
  background-color: #a0d8bf;
  cursor: not-allowed;
}

.error-message {
  color: #dc3545;
  background-color: #f8d7da;
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.patient-record {
  background-color: #fff;
  border: 1px solid #e1e4e8;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.record-details p {
  margin: 8px 0;
  font-size: 1.1em;
}

.cds-cards h2 {
  color: #d35400;
  border-bottom: 2px solid #eee;
  padding-bottom: 10px;
}

.card {
  background: white;
  border: 1px solid #ddd;
  border-left: 6px solid #6c757d;
  padding: 20px;
  margin-bottom: 15px;
  border-radius: 6px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.card h3 {
  margin-top: 0;
}

/* 摘要、症狀、資料來源原本是同一段的 \n，用 pre-line 讓它們分行顯示 */
.card p {
  white-space: pre-line;
}

.card.info { border-left-color: #17a2b8; }
.card.warning { border-left-color: #ffc107; }
.card.critical { border-left-color: #dc3545; }

.suggestions {
  margin-top: 12px;
}

.action-btn {
  padding: 8px 16px;
  background-color: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.action-btn:disabled {
  background-color: #aaa;
  cursor: not-allowed;
}

.task-ok {
  margin-left: 10px;
  color: #27ae60;
}

.task-error {
  margin-left: 10px;
  color: #c0392b;
}

.source-link {
  display: inline-block;
  margin-top: 10px;
  color: #007bff;
  text-decoration: none;
  font-size: 0.9em;
}

.source-link:hover {
  text-decoration: underline;
}
/* ===== 候診清單 ===== */
.waiting-list {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.wl-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.wl-header h2 {
  margin: 0;
  color: #2c3e50;
}

.wl-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.wl-updated {
  color: #777;
  font-size: 0.85em;
}

.wl-refresh {
  padding: 8px 16px;
  background-color: #2c3e50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.wl-refresh:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}

.wl-warning {
  background-color: #fff3cd;
  color: #856404;
  padding: 12px 15px;
  border-radius: 4px;
  margin-bottom: 12px;
}

.wl-empty {
  color: #777;
  text-align: center;
  padding: 24px 0;
}

.wl-row {
  border: 1px solid #ddd;
  border-left: 6px solid #6c757d;
  border-radius: 6px;
  padding: 12px 15px;
  margin-bottom: 10px;
  cursor: pointer;
  background: #fff;
}

.wl-row:hover { background: #f8f9fa; }
.wl-row.needs-human { border-left-color: #dc3545; background: #fff5f5; }
.wl-row.selected { outline: 2px solid #2c3e50; }

.wl-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.wl-id { color: #2c3e50; }

.badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: bold;
  color: white;
}

.score-high { background-color: #dc3545; }
.score-mid { background-color: #e67e22; }
.score-low { background-color: #27ae60; }
.score-unknown { background-color: #7f8c8d; }
.badge-human { background-color: #8e1b27; }
.badge-recent { background-color: #fff3cd; color: #856404; border: 1px solid #ffe08a; }

.wl-symptoms { color: #444; font-size: 0.95em; margin-bottom: 4px; }
.wl-summary { color: #222; }
.wl-time { color: #888; font-size: 0.8em; margin-top: 6px; }
</style>