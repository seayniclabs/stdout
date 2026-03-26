import crypto from 'node:crypto';

/**
 * Simple AES-256-GCM encryption for data source credentials.
 * Uses a server-derived key from STDOUT_ENCRYPTION_KEY env var
 * or falls back to a deterministic key derived from the DB path.
 *
 * NOT a substitute for a proper secrets manager, but prevents
 * plaintext tokens sitting in SQLite.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const envKey = process.env.STDOUT_ENCRYPTION_KEY;
  if (envKey) {
    // Use provided key (should be 32 bytes hex-encoded)
    return crypto.createHash('sha256').update(envKey).digest();
  }
  // Fallback: derive from DB_PATH + a constant salt
  const seed = (process.env.DB_PATH || './data/stdout.db') + ':stdout-ds-key';
  return crypto.createHash('sha256').update(seed).digest();
}

/**
 * Encrypt a plaintext string. Returns base64-encoded ciphertext
 * with IV and auth tag prepended.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: iv (12) + tag (16) + ciphertext
  const result = Buffer.concat([iv, tag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext produced by encrypt().
 * Returns null if decryption fails (wrong key, tampered data).
 */
export function decrypt(encoded: string): string | null {
  try {
    const key = getEncryptionKey();
    const data = Buffer.from(encoded, 'base64');
    if (data.length < IV_LENGTH + TAG_LENGTH) return null;

    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
