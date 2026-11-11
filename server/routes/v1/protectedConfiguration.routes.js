const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { validateRequest } = require('../../middleware/validateRequest');
const {
  listConfigurations,
  getConfigurationByName,
  lockConfiguration,
  unlockConfiguration,
  restoreConfigurationVersion,
  getConfigurationHistory,
  logConfigurationChange
} = require('../../controllers/protectedConfiguration.controller');

const router = express.Router();
const configIdParamSchema = {
  configId: { required: true, type: 'string', uuid: true }
};
const configNameParamSchema = {
  name: { required: true, type: 'string', minLength: 1, maxLength: 100 }
};

router.use(authenticate);
router.use(authorizeProfile());

router.get('/', listConfigurations);

router.get(
  '/by-name/:name',
  validateRequest({
    params: {
      name: { required: true, type: 'string', minLength: 1, maxLength: 100 }
    }
  }),
  getConfigurationByName
);

router.post(
  '/:configId/changelog',
  validateRequest({ params: configIdParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  logConfigurationChange
);

router.post(
  '/:configId/lock',
  validateRequest({ params: configIdParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  lockConfiguration
);

router.post(
  '/:configId/unlock',
  validateRequest({ params: configIdParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  unlockConfiguration
);

router.post(
  '/:configId/restore',
  validateRequest({
    params: configIdParamSchema,
    body: {
      version: { required: true, type: 'string', minLength: 1, maxLength: 50 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  restoreConfigurationVersion
);

router.get(
  '/:configId/history',
  validateRequest({ params: configIdParamSchema }),
  getConfigurationHistory
);

module.exports = router;
