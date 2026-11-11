const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { search } = require('../../controllers/globalSearch.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  validateRequest({
    query: {
      q: { type: 'string', maxLength: 255 },
      search: { type: 'string', maxLength: 255 },
      types: { type: 'string', maxLength: 500 },
      limitPerType: { type: 'string' }
    }
  }),
  authorizeProfile(),
  search
);

module.exports = router;
