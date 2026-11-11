const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { getCsvMappingConfig, saveCsvMappingConfig } = require('../../controllers/csvMappingConfig.controller');

const router = express.Router();

router.use(authenticate);

router.get('/match', authorizeProfile(), getCsvMappingConfig);
router.post('/', authorizeProfile({ requiredRole: 'editor' }), saveCsvMappingConfig);

module.exports = router;
