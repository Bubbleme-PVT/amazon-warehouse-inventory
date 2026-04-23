const express = require('express');
const path = require('path');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
let PORT = process.env.PORT || 3000;

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

// Attempt to start on the desired port, fallback to random free port if busy
const server = app.listen(PORT, () => {
  console.log(`Warehouse dashboard running at http://localhost:${server.address().port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} in use, selecting a free port...`);
    // Let OS pick an available port
    const tempServer = app.listen(0, () => {
      console.log(`Warehouse dashboard running at http://localhost:${tempServer.address().port}`);
    });
    tempServer.on('error', (e) => {
      console.error('Failed to start server on any port:', e);
    });
  } else {
    console.error('Server error:', err);
  }
});