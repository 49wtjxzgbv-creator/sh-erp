import { decryptApiKey, encryptApiKey } from './ai-crypto.util';

describe('ai-crypto.util — AES-256-GCM envelope encryption for CompanyAiSettings.apiKeyEncrypted', () => {
  const originalSecret = process.env.AI_API_KEY_ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.AI_API_KEY_ENCRYPTION_SECRET = 'test-secret-value';
  });

  afterAll(() => {
    process.env.AI_API_KEY_ENCRYPTION_SECRET = originalSecret;
  });

  it('round-trips a plaintext key', () => {
    const plaintext = 'AIzaSy-super-secret-key-1234567890';
    const encrypted = encryptApiKey(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptApiKey(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext', () => {
    const a = encryptApiKey('same-key');
    const b = encryptApiKey('same-key');
    expect(a).not.toBe(b);
    expect(decryptApiKey(a)).toBe('same-key');
    expect(decryptApiKey(b)).toBe('same-key');
  });

  it('throws if AI_API_KEY_ENCRYPTION_SECRET is not configured', () => {
    delete process.env.AI_API_KEY_ENCRYPTION_SECRET;
    expect(() => encryptApiKey('x')).toThrow();
  });

  it('throws when decrypting a malformed stored value', () => {
    expect(() => decryptApiKey('not-the-right-shape')).toThrow();
  });
});
