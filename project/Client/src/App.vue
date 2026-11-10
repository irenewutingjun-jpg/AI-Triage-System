<script setup>
// App.vue 不需要太多邏輯，只要負責導航
</script>

<template>
  <div class="app-container">
    <nav class="nav-bar">
      <div class="logo">🏥 AI Triage System</div>
      <div class="links">
        <router-link to="/" class="nav-link">病人端 (Patient)</router-link>
        <router-link to="/doctor" class="nav-link doctor-link">醫師端 (Doctor)</router-link>
      </div>
    </nav>

    <div class="main-content">
      <router-view></router-view>
    </div>
  </div>
</template>

<style scoped>
/* 全域導覽列樣式 */
.app-container {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  color: #2c3e50;
}

.nav-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: #2c3e50;
  color: white;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.logo {
  font-size: 1.2rem;
  font-weight: bold;
}

.links {
  display: flex;
  gap: 1.5rem;
}

.nav-link {
  color: #bdc3c7;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-link:hover, .nav-link.router-link-active {
  color: #ffffff;
}

/* 醫師端按鈕特別顏色 */
.doctor-link:hover, .doctor-link.router-link-active {
  color: #f1c40f; 
}

.main-content {
  padding: 2rem;
  background-color: #ecf0f1;
  min-height: calc(100vh - 60px);
}
</style>