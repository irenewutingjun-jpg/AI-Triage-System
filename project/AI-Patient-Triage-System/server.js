const express = require('express');
const cors = require('cors');
const triageRoutes = require('./routes/triage');
const cdsHooksRoutes = require('./routes/cds-hooks'); // <--- 引入新檔案
const resultsRoutes = require('./routes/results'); // 候診清單 API
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // 允許前端 Vue 呼叫
app.use(express.json());

// Routes
app.use('/api/triage', triageRoutes);
app.use('/api/triage/results', resultsRoutes); // GET 候診清單

// 新增給 EHR 用 (標準 CDS Hooks)
// 注意：這裡通常直接掛在根目錄，因為標準路徑是 /cds-services
app.use('/cds-services', cdsHooksRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});