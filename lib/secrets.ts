import 'server-only';
import crypto from 'crypto';

/**
 * Optional encryption at rest for the secrets saved from the admin panel
 * (Gmail app passwords, PayPur key and salt).
 *
 * Set SETTINGS_ENCRYPTION_KEY in Vercel (any long random string, e.g.
 * `openssl rand -hex 32`) and every secret saved from then on is stored as
 *   enc:v1:<base64 of iv | auth tag | AES-256-GCM ciphertext>
 * so a copy of the database alone does not reveal them. Without the variable,
 * secrets are stored as typed. Both forms are always readable: values saved
 * before the key was set stay readable, and reading an encrypted value needs
 * the same key. Losing or changing the key makes encrypted values unreadable:
 * the affected passwords then have to be entered again in the panel.
 */

const PREFIX = 'enc:v1:';

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

function encryptionKey(): Buffer | null {
  const raw = (process.env.SETTINGS_ENCRYPTION_KEY || '').trim();
  return raw ? crypto.createHash('sha256').update(raw).digest() : null;
}

export function encryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Prepares a secret for the database: encrypted if a key is configured, else unchanged. */
export function sealSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Reads a secret back from the database (encrypted or plain). */
export function openSecret(stored: string | null | undefined): string {
  const value = String(stored ?? '');
  if (!isSealed(value)) return value;
  const key = encryptionKey();
  if (!key) {
    throw new SecretError('This value is encrypted but SETTINGS_ENCRYPTION_KEY is not set in Vercel.');
  }
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretError('This value could not be decrypted: SETTINGS_ENCRYPTION_KEY has changed. Enter it again in the panel.');
  }
}
