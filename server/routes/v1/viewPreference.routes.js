const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  getViewPreference,
  saveViewPreference,
  deleteViewPreference,
  deleteAllViewPreferences
} = require('../../controllers/viewPreference.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorizeProfile());

router.get(
  '/:viewName',
  validateRequest({ params: { viewName: { required: true, type: 'string', maxLength: 100 } } }),
  getViewPreference
);

router.put(
  '/:viewName',
  validateRequest({
    params: { viewName: { required: true, type: 'string', maxLength: 100 } },
    body: { preferences: { type: 'object' } }
  }),
  saveViewPreference
);

router.delete(
  '/',
  deleteAllViewPreferences
);

router.delete(
  '/:viewName',
  validateRequest({ params: { viewName: { required: true, type: 'string', maxLength: 100 } } }),
  deleteViewPreference
);

module.exports = router;
