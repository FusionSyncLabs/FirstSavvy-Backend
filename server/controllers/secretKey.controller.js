const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  createSecretKey,
  verifySecretKey,
  getActiveSecretKey,
  expireSecretKey,
  deleteSecretKey,
} = require('../services/secretKey.service');

const createSecretKeyHandler = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const result = await createSecretKey(req.auth.sub, { name });
  return created(res, result);
});

const verifySecretKeyHandler = asyncHandler(async (req, res) => {
  const { key } = req.body;
  const result = await verifySecretKey(req.auth.sub, key);
  return ok(res, result);
});

const getActiveSecretKeyHandler = asyncHandler(async (req, res) => {
  const result = await getActiveSecretKey(req.auth.sub);
  return ok(res, { secretKey: result });
});

const expireSecretKeyHandler = asyncHandler(async (req, res) => {
  const { keyId } = req.params;
  const result = await expireSecretKey(req.auth.sub, keyId);
  return ok(res, result);
});

const deleteSecretKeyHandler = asyncHandler(async (req, res) => {
  const { keyId } = req.params;
  const result = await deleteSecretKey(req.auth.sub, keyId);
  return ok(res, result);
});

module.exports = {
  createSecretKeyHandler,
  verifySecretKeyHandler,
  getActiveSecretKeyHandler,
  expireSecretKeyHandler,
  deleteSecretKeyHandler,
};