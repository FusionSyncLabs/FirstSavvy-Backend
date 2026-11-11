const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

const FILE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

function fileUpload(fieldName, options = {}) {
  const maxBytes = options.maxBytes || FILE_UPLOAD_MAX_BYTES;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1
    },
    fileFilter: (_req, file, cb) => {
      if (options.requireImage && !String(file.mimetype || '').toLowerCase().startsWith('image/')) {
        return cb(ApiError.badRequest('Uploaded file must be an image', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: fieldName, message: 'Must be an image file' }]
        }));
      }

      return cb(null, true);
    }
  }).single(fieldName);

  return (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest(options.tooLargeMessage || 'Uploaded file is too large', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: fieldName, message: `Must be ${Math.floor(maxBytes / 1024 / 1024)}MB or smaller` }]
        }));
      }

      return next(error);
    });
  };
}

function normalizeMultipartFields(options = {}) {
  const numericFields = new Set(options.numericFields || []);
  const booleanFields = new Set(options.booleanFields || []);
  const jsonFields = new Set(options.jsonFields || []);

  return (req, _res, next) => {
    if (!req.is('multipart/form-data')) return next();

    try {
      Object.entries(req.body || {}).forEach(([key, value]) => {
        if (numericFields.has(key)) {
          req.body[key] = value === '' ? undefined : Number(value);
        } else if (booleanFields.has(key)) {
          req.body[key] = value === 'true' || value === '1';
        } else if (jsonFields.has(key)) {
          req.body[key] = value ? JSON.parse(value) : undefined;
        }
      });

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  fileUpload,
  normalizeMultipartFields
};
