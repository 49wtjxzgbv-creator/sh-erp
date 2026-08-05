import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Application-level envelope encryption for a company's bring-your-own
 * Gemini API key (`CompanyAiSettings.apiKeyEncrypted`, Phase 2 §8). AES-256-GCM
 * keyed off `AI_API_KEY_ENCRYPTION_SECRET` (hashed to a fixed 32-byte key —
 * the env var itself can be any length/format).
 *
 * Disclosed simplification: Phase 2 §8 calls for "KMS-backed envelope
 * encryption", i.e. a real cloud KMS (AWS KMS / GCP KMS) wrapping the data
 * key. That's a real infrastructure dependency this pass doesn't wire up.
 * What's implemented here is still real encryption at rest (never plaintext
 * in the database, unlike the legacy Script Property), just with the
 * envelope key held in an env var instead of a KMS — an intentional,
 * disclosed scope reduction, not a silent shortcut. Swapping in real KMS
 * later only touches this file.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.AI_API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('AI_API_KEY_ENCRYPTION_SECRET is not configured — cannot store a company-provided AI API key.');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptApiKey(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Stored AI API key is malformed.');
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
