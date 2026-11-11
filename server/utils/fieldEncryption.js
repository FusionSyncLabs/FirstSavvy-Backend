const crypto = require('crypto');
const { env } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'enc:v1:';

function getEncryptionKey() {
  const raw = env.fieldEncryptionKey;
  const key = Buffer.from(raw, 'hex');

  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  return key;
}

function encryptField(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') {
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptField(ciphertext) {
  if (ciphertext === undefined || ciphertext === null || ciphertext === '') {
    return ciphertext;
  }

  if (!String(ciphertext).startsWith(PREFIX)) {
    return ciphertext;
  }

  const payload = String(ciphertext).slice(PREFIX.length);
  const [ivBase64, tagBase64, dataBase64] = payload.split(':');

  if (!ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error('Invalid encrypted field format');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataBase64, 'base64')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  encryptField,
  decryptField
};
