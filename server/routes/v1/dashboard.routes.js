const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { getDashboardData } = require('../../controllers/dashboard.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/data',
  authorizeProfile(),
  getDashboardData
);

module.exports = router;
