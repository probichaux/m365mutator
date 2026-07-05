import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const VERSION_V1 = 0x01;

/** Decoded length of a v1 blob: version(1) + salt(32) + iv(12) + authTag(16) = 61 */
const V1_MIN_LENGTH = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

export function encrypt(plaintext: string, password: string): string {
  if (!plaintext) return '';
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format v1: base64(version[1] + salt[32] + iv[12] + authTag[16] + ciphertext)
  return Buffer.concat([Buffer.from([VERSION_V1]), salt, iv, authTag, encrypted]).toString('base64');
}

export function decrypt(encoded: string, password: string): string {
  if (!encoded) return '';
  const data = Buffer.from(encoded, 'base64');
  if (data.length < V1_MIN_LENGTH || data[0] !== VERSION_V1) {
    throw new Error('Corrupted or unrecognized ciphertext');
  }

  const salt = data.subarray(1, 1 + SALT_LENGTH);
  const iv = data.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const authTag = data.subarray(1 + SALT_LENGTH + IV_LENGTH, 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
