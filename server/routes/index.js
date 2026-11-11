const express = require('express');
const v1Routes = require('./v1');
const { ok } = require('../utils/apiResponse');

const router = express.Router();

router.get('/', (_req, res) => {
  return ok(res, {
    service: 'firstsavvy-api',
    version: 'v1'
  });
});

router.use('/api/v1', v1Routes);

module.exports = router;
