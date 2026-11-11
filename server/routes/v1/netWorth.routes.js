const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { getNetWorthSummary, getNetWorthForecast } = require('../../controllers/netWorth.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/summary',
  authorizeProfile(),
  getNetWorthSummary
);

router.get(
  '/forecast',
  authorizeProfile(),
  getNetWorthForecast
);

module.exports = router;
