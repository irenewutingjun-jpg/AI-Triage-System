// src/composables/usePatientId.js
// 病人 ID 讓病人頁和醫師頁共用，並記在這台瀏覽器的 localStorage，
// 換頁或重新整理都不用再打一次。上課範例是兩頁各自一個 ref，換頁就歸零。
import { ref, watch } from 'vue';

const KEY = 'triage-patient-id';
const DEFAULT_ID = 'patient-tw-001';

function load() {
  try {
    return localStorage.getItem(KEY) || DEFAULT_ID;
  } catch (e) {
    return DEFAULT_ID;   // 無痕視窗或 localStorage 被擋，就用預設值
  }
}

// 放在模組最外層：整個 app 只有這一個 ref，哪個元件 import 都拿到同一個
const patientId = ref(load());

watch(patientId, (v) => {
  try {
    localStorage.setItem(KEY, v.trim());
  } catch (e) {
    // 存不進去就只留在記憶體，換頁仍然共用，重新整理後回到預設值
  }
});

export function usePatientId() {
  return patientId;
}
