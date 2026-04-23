const express = require('express');
const multer = require('multer');
const controller = require('../controllers/dashboardController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 20
  }
});

router.post('/upload', upload.array('files', 20), controller.uploadFiles);
router.post('/build', controller.buildDashboard);
router.get('/export', controller.exportSummary);

module.exports = router;
