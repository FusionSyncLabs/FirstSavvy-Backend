const fs = require('fs');
const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const {
  isS3Configured,
  createUploadTarget,
  uploadPublicObject,
  createDownloadUrl,
  deleteObject,
  extractKeyFromPublicUrl,
  getLocalFilePath
} = require('../services/fileStorage.service');

function getPublicFilesBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto
    ? String(forwardedProto).split(',')[0].trim()
    : (req.secure ? 'https' : req.protocol);
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (!host) return '/api/v1/files/public';
  return `${proto}://${host}/api/v1/files/public`;
}

const createPresignedUpload = asyncHandler(async (req, res) => {
  return ok(res, {
    file: await createUploadTarget(req.body, {
      userId: req.auth.sub,
      publicFilesBaseUrl: getPublicFilesBaseUrl(req)
    })
  });
});

const uploadDirectFile = asyncHandler(async (req, res) => {
  if (!req.file?.buffer?.length) {
    throw ApiError.badRequest('No file uploaded or file is empty');
  }

  const result = await uploadPublicObject({
    category: req.body.category || 'general',
    profileId: req.body.profileId || null,
    fileName: req.file.originalname || 'upload',
    contentType: req.file.mimetype || 'application/octet-stream',
    fileSize: req.file.size,
    body: req.file.buffer
  }, {
    userId: req.auth.sub,
    publicFilesBaseUrl: getPublicFilesBaseUrl(req)
  });

  return ok(res, result);
});

const redirectPublicFile = asyncHandler(async (req, res) => {
  const key = req.params[0];
  if (isS3Configured()) {
    return res.redirect(302, await createDownloadUrl(key));
  }

  const localPath = getLocalFilePath(key);
  if (localPath && fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  return res.status(404).json({ error: { message: 'File not found' } });
});

const createDownload = asyncHandler(async (req, res) => {
  return ok(res, {
    url: await createDownloadUrl(req.body.key)
  });
});

const deleteFile = asyncHandler(async (req, res) => {
  const key = req.body.key || extractKeyFromPublicUrl(req.body.publicUrl);
  return ok(res, await deleteObject(key));
});

module.exports = {
  createPresignedUpload,
  uploadDirectFile,
  redirectPublicFile,
  createDownload,
  deleteFile
};
