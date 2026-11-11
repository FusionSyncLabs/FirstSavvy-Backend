const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { fileUpload } = require('../../middleware/upload');
const {
  createPresignedUpload,
  uploadDirectFile,
  redirectPublicFile,
  createDownload,
  deleteFile
} = require('../../controllers/file.controller');

const router = express.Router();

router.get(/^\/public\/(.+)$/, redirectPublicFile);

router.use(authenticate);

router.post(
  '/upload',
  fileUpload('file', {
    maxBytes: 10 * 1024 * 1024
  }),
  uploadDirectFile
);

router.post(
  '/presigned-upload',
  validateRequest({
    body: {
      category: { required: true, type: 'string', maxLength: 100 },
      profileId: { type: 'string', maxLength: 100 },
      fileName: { required: true, type: 'string', maxLength: 255 },
      contentType: { type: 'string', maxLength: 100 },
      fileSize: { type: 'number' }
    }
  }),
  createPresignedUpload
);

router.post(
  '/download',
  validateRequest({
    body: {
      key: { required: true, type: 'string', maxLength: 2000 }
    }
  }),
  createDownload
);

router.delete(
  '/',
  validateRequest({
    body: {
      key: { type: 'string', maxLength: 2000 },
      publicUrl: { type: 'string', maxLength: 3000 }
    }
  }),
  deleteFile
);

module.exports = router;
