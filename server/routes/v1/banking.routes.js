const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { listRecurringPayments } = require('../../controllers/banking.controller');

const router = express.Router();

router.use(authenticate);

router.get('/recurring-payments', authorizeProfile(), listRecurringPayments);

module.exports = router;
