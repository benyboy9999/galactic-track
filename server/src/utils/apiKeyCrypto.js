import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'crypto';

const secret = process.env.API_KEY_SECRET;
if (!secret) throw new Error('API_KEY_SECRET env var is required');

// Derive separate AES and HMAC keys from the single secret
const AES_KEY  = scryptSync(secret, 'aes-salt',  32);
const HMAC_KEY = scryptSync(secret, 'hmac-salt', 32);

/** Deterministic 64-char hex identifier — stored in api_key column for UNIQUE/ON CONFLICT */
export function hashApiKey(plaintext) {
  return createHmac('sha256', HMAC_KEY).update(plaintext).digest('hex');
}

/** AES-256-GCM encrypt — stored in api_key_encrypted column */
export function encryptApiKey(plaintext) {
  const iv        = randomBytes(12);
  const cipher    = createCipheriv('aes-256-gcm', AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** AES-256-GCM decrypt */
export function decryptApiKey(encoded) {
  const buf       = Buffer.from(encoded, 'base64');
  const iv        = buf.subarray(0, 12);
  const tag       = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher  = createDecipheriv('aes-256-gcm', AES_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
