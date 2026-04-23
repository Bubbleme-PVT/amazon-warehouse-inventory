const express = require('express');
const path = require('path');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

// Use JSON and URL-encoded middleware
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', dashboardRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'warehouse-dashboard', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || 'Unexpected error'
  });
});

// Listen on any free port
const server = app.listen(0, () => {
  console.log(`Warehouse dashboard running at http://localhost:${server.address().port}`);
});