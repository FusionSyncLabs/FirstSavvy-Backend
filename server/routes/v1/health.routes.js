const express = require('express');
const { getDatabaseHealth, getHealth } = require('../../controllers/health.controller');

const router = express.Router();

router.get('/', getHealth);
router.get('/db', getDatabaseHealth);

module.exports = router;
