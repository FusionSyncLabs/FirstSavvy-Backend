const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { env } = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

const DEFAULT_UPLOAD_EXPIRES_SECONDS = 10 * 60;
const DEFAULT_DOWNLOAD_EXPIRES_SECONDS = 5 * 60;

let s3Client = null;

function isS3Configured() {
  return Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);
}

function assertConfigured() {
  if (!isS3Configured()) {
    console.error("S3 storage service is not configured.");
    throw ApiError.badRequest("Image/File storage service is not configured, therefore cannot upload or download files", {
      code: ERROR_CODES.S3_SERVICE_NOT_CONFIGURED,
      details: {
        required: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        message: "S3 storage is not configured"
      }
    });
  }
}

function getS3Client() {
  assertConfigured();

  if (!s3Client) {
    s3Client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey
      }
    });
  }

  return s3Client;
}

async function createUploadTarget(input = {}, context = {}) {
  const fileName = normalizeFileName(input.fileName);
  const contentType = normalizeContentType(input.contentType);
  const fileSize = Number(input.fileSize || 0);

  if (fileSize > env.s3UploadMaxBytes) {
    throw ApiError.badRequest('File is too large', {
      details: { maxBytes: env.s3UploadMaxBytes }
    });
  }

  const key = buildObjectKey({
    category: input.category,
    userId: context.userId,
    profileId: input.profileId,
    fileName
  });
  const command = new PutObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: DEFAULT_UPLOAD_EXPIRES_SECONDS
  });

  return {
    key,
    publicUrl: buildPublicUrl(key, context),
    upload: {
      url: uploadUrl,
      method: 'PUT',
      headers: {
        'content-type': contentType
      },
      expiresAt: new Date(Date.now() + DEFAULT_UPLOAD_EXPIRES_SECONDS * 1000).toISOString()
    }
  };
}

async function uploadPublicObject(input = {}, context = {}) {
  const fileName = normalizeFileName(input.fileName);
  const contentType = normalizeContentType(input.contentType);
  const body = input.body;
  const fileSize = Number(input.fileSize || body?.length || 0);

  if (!Buffer.isBuffer(body)) {
    throw ApiError.badRequest('File body is required');
  }

  if (fileSize > env.s3UploadMaxBytes) {
    throw ApiError.badRequest('File is too large', {
      details: { maxBytes: env.s3UploadMaxBytes }
    });
  }

  const key = buildObjectKey({
    category: input.category,
    userId: context.userId,
    profileId: input.profileId,
    fileName
  });

  if (!isS3Configured()) {
    try {
      const localPath = getLocalFilePath(key);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, body);
      return {
        key,
        publicUrl: buildPublicUrl(key, context)
      };
    } catch (localErr) {
      console.warn('Failed to save to local uploads dir, falling back to base64 data URI:', localErr);
      return {
        key,
        publicUrl: `data:${contentType};base64,${body.toString('base64')}`
      };
    }
  }

  await getS3Client().send(new PutObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));

  return {
    key,
    publicUrl: buildPublicUrl(key, context)
  };
}

const LOCAL_UPLOADS_DIR = path.resolve(__dirname, '../uploads');

function getLocalFilePath(key) {
  const normalizedKey = normalizeStorageKey(key);
  return path.join(LOCAL_UPLOADS_DIR, normalizedKey);
}

async function createDownloadUrl(key, expiresSeconds = DEFAULT_DOWNLOAD_EXPIRES_SECONDS) {
  const normalizedKey = normalizeStorageKey(key);
  if (!isS3Configured()) {
    return `/api/v1/files/public/${encodeS3Key(normalizedKey)}`;
  }

  const command = new GetObjectCommand({
    Bucket: env.s3Bucket,
    Key: normalizedKey
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: expiresSeconds });
}

async function deleteObject(key) {
  if (!isS3Configured()) {
    try {
      const localPath = getLocalFilePath(key);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    } catch (e) {
      console.warn('Could not delete local file:', e);
    }
    return { key, deleted: true };
  }

  const normalizedKey = normalizeStorageKey(key);

  await getS3Client().send(new DeleteObjectCommand({
    Bucket: env.s3Bucket,
    Key: normalizedKey
  }));

  return { key: normalizedKey, deleted: true };
}

function extractKeyFromPublicUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return null;

  const marker = '/files/public/';
  const index = url.indexOf(marker);
  if (index !== -1) {
    const rawKey = url.slice(index + marker.length).split('?')[0];
    return normalizeStorageKey(decodeURIComponent(rawKey));
  }

  if (env.s3PublicBaseUrl && url.startsWith(env.s3PublicBaseUrl)) {
    const rawKey = url.slice(env.s3PublicBaseUrl.length).replace(/^\/+/, '').split('?')[0];
    return normalizeStorageKey(decodeURIComponent(rawKey));
  }

  const awsKey = extractKeyFromAwsS3Url(url);
  if (awsKey) return awsKey;

  return null;
}

function extractKeyFromAwsS3Url(url) {
  if (!env.s3Bucket) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const bucket = env.s3Bucket.toLowerCase();
  const path = parsed.pathname.replace(/^\/+/, '');
  if (!path) return null;

  if (hostname === `${bucket}.s3.amazonaws.com` || hostname.startsWith(`${bucket}.s3.`)) {
    return normalizeStorageKey(decodeURIComponent(path));
  }

  if ((hostname === 's3.amazonaws.com' || hostname.startsWith('s3.')) && path.toLowerCase().startsWith(`${bucket}/`)) {
    return normalizeStorageKey(decodeURIComponent(path.slice(env.s3Bucket.length + 1)));
  }

  return null;
}

function buildPublicUrl(key, context = {}) {
  if (env.s3PublicBaseUrl) {
    return `${env.s3PublicBaseUrl.replace(/\/$/, '')}/${encodeS3Key(key)}`;
  }

  const baseUrl = context.publicFilesBaseUrl || '/api/v1/files/public';
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
}

function buildObjectKey({ category, userId, profileId, fileName }) {
  const safeCategory = sanitizePathPart(category || 'documents');
  const owner = sanitizePathPart(profileId || userId || 'unscoped');
  const now = new Date();
  const datePart = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0')
  ].join('/');
  const unique = crypto.randomUUID();

  return `${safeCategory}/${owner}/${datePart}/${unique}-${fileName}`;
}

function normalizeFileName(fileName) {
  const fallback = 'upload.bin';
  const raw = String(fileName || fallback).split(/[\\/]/).pop() || fallback;
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return sanitized.slice(0, 180) || fallback;
}

function normalizeContentType(contentType) {
  const value = String(contentType || 'application/octet-stream').trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value)
    ? value
    : 'application/octet-stream';
}

function normalizeStorageKey(key) {
  const normalized = String(key || '').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\\')) {
    throw ApiError.badRequest('Invalid storage key');
  }
  return normalized;
}

function sanitizePathPart(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._=-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'unknown';
}

function encodeS3Key(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function normalizePublicFileUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('color:') || trimmed.startsWith('preset:')) {
    return trimmed;
  }

  // Convert any stored http:// or localhost/internal /api/v1/files/public/... URL into a relative path
  // or upgrade http:// production URLs when accessed via the frontend/API
  const marker = '/api/v1/files/public/';
  const markerIdx = trimmed.indexOf(marker);
  if (markerIdx !== -1) {
    const suffix = trimmed.slice(markerIdx); // "/api/v1/files/public/..."
    try {
      const parsed = new URL(trimmed);
      // If stored with http:// on a non-localhost domain (behind Nginx SSL proxy), upgrade to https://
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (!isLocal && parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
        return parsed.toString();
      }
      // If running in production and DB has a localhost URL, return relative path so browser resolves via current origin/API
      if (isLocal && env.isProduction) {
        return suffix;
      }
    } catch {
      return suffix;
    }
  }

  return trimmed;
}

module.exports = {
  isS3Configured,
  createUploadTarget,
  uploadPublicObject,
  createDownloadUrl,
  deleteObject,
  extractKeyFromPublicUrl,
  getLocalFilePath,
  normalizePublicFileUrl
};
