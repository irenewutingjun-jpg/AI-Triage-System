import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// 1. 建立 App 實體
const app = createApp(App)

// 2. 掛載 Router (必須在 mount 之前)
app.use(router)

// 3. 最後才掛載到網頁上
app.mount('#app')