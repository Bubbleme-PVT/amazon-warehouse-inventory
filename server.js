const express = require('express');
const path = require('path');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', dashboardRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'warehouse-dashboard', timestamp: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || 'Unexpected error'
  });
});

app.listen(PORT, () => {
  console.log(`Warehouse dashboard running at http://localhost:${PORT}`);
});
