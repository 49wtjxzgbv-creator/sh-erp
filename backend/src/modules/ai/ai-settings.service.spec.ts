import { AiSettingsService } from './ai-settings.service';

describe('AiSettingsService', () => {
  let service: AiSettingsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };
  const originalSecret = process.env.AI_API_KEY_ENCRYPTION_SECRET;
  const originalPlatformKey = process.env.AI_PLATFORM_API_KEY;

  beforeEach(() => {
    process.env.AI_API_KEY_ENCRYPTION_SECRET = 'test-secret';
    prisma = {
      tenant: {
        companyAiSettings: { findUnique: jest.fn(), upsert: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new AiSettingsService(prisma, audit);
  });

  afterAll(() => {
    process.env.AI_API_KEY_ENCRYPTION_SECRET = originalSecret;
    process.env.AI_PLATFORM_API_KEY = originalPlatformKey;
  });

  describe('getSettings — never exposes the key itself', () => {
    it('reports hasCustomApiKey: false and provider: gemini when nothing is configured', async () => {
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue(null);
      const result = await service.getSettings(user);
      expect(result).toEqual({ companyId: 'c1', provider: 'gemini', hasCustomApiKey: false, monthlyUsageQuota: null });
    });

    it('reports the stored provider once one has been picked', async () => {
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'deepseek', apiKeyEncrypted: null, monthlyUsageQuota: null });
      const result = await service.getSettings(user);
      expect(result.provider).toBe('deepseek');
    });

    it('reports hasCustomApiKey: true without ever returning the ciphertext', async () => {
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ apiKeyEncrypted: 'iv:tag:ct', monthlyUsageQuota: 5000 });
      const result = await service.getSettings(user);
      expect(result.hasCustomApiKey).toBe(true);
      expect(result.monthlyUsageQuota).toBe(5000);
      expect(JSON.stringify(result)).not.toContain('iv:tag:ct');
    });
  });

  describe('updateSettings', () => {
    it('encrypts a non-empty apiKey before storing it', async () => {
      prisma.tenant.companyAiSettings.upsert.mockResolvedValue({});
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ apiKeyEncrypted: 'x:y:z', monthlyUsageQuota: null });

      await service.updateSettings(user, { apiKey: 'my-real-gemini-key' });

      const call = prisma.tenant.companyAiSettings.upsert.mock.calls[0][0];
      expect(call.update.apiKeyEncrypted).not.toBe('my-real-gemini-key');
      expect(call.update.apiKeyEncrypted).toContain(':'); // iv:tag:ciphertext shape
    });

    it('clears the key when apiKey is an empty string (falls back to the platform key)', async () => {
      prisma.tenant.companyAiSettings.upsert.mockResolvedValue({});
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ apiKeyEncrypted: null, monthlyUsageQuota: null });

      await service.updateSettings(user, { apiKey: '' });

      const call = prisma.tenant.companyAiSettings.upsert.mock.calls[0][0];
      expect(call.update.apiKeyEncrypted).toBeNull();
    });

    it('records an audit event without leaking whether a key value was set', async () => {
      prisma.tenant.companyAiSettings.upsert.mockResolvedValue({});
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ apiKeyEncrypted: null, monthlyUsageQuota: null });

      await service.updateSettings(user, { apiKey: 'secret' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai_settings.updated', metadata: expect.objectContaining({ apiKeyChanged: true }) }),
      );
    });
  });

  describe('getEffectiveApiKey', () => {
    it('decrypts and returns a company-provided key when set', async () => {
      const { encryptApiKey } = require('./ai-crypto.util');
      const ciphertext = encryptApiKey('company-own-key');
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ apiKeyEncrypted: ciphertext });

      const key = await service.getEffectiveApiKey('c1');
      expect(key).toBe('company-own-key');
    });

    it('falls back to the platform-provided key when no company key is set (provider defaults to gemini)', async () => {
      process.env.AI_PLATFORM_API_KEY = 'platform-key';
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue(null);

      const key = await service.getEffectiveApiKey('c1');
      expect(key).toBe('platform-key');
    });

    it('throws AI_DEEPSEEK_KEY_REQUIRED when provider is deepseek and no company key is set — never falls back to the (Gemini) platform key', async () => {
      process.env.AI_PLATFORM_API_KEY = 'platform-key';
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'deepseek', apiKeyEncrypted: null });

      await expect(service.getEffectiveApiKey('c1')).rejects.toThrow('DeepSeek requires your own API key');
    });

    it('returns the company\'s own key when provider is deepseek and a key is set', async () => {
      const { encryptApiKey } = require('./ai-crypto.util');
      const ciphertext = encryptApiKey('deepseek-own-key');
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'deepseek', apiKeyEncrypted: ciphertext });

      const key = await service.getEffectiveApiKey('c1');
      expect(key).toBe('deepseek-own-key');
    });
  });

  describe('getProvider', () => {
    it('defaults to gemini when nothing is configured', async () => {
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue(null);
      expect(await service.getProvider('c1')).toBe('gemini');
    });

    it('returns the stored provider', async () => {
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'deepseek' });
      expect(await service.getProvider('c1')).toBe('deepseek');
    });
  });

  describe('getGeminiApiKey — always Gemini, regardless of the company\'s chosen provider', () => {
    it('uses the company key when provider is gemini', async () => {
      const { encryptApiKey } = require('./ai-crypto.util');
      const ciphertext = encryptApiKey('my-gemini-key');
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'gemini', apiKeyEncrypted: ciphertext });

      expect(await service.getGeminiApiKey('c1')).toBe('my-gemini-key');
    });

    it('falls back to the platform key when provider is deepseek — the stored key is a DeepSeek key, wrong vendor for this call', async () => {
      process.env.AI_PLATFORM_API_KEY = 'platform-key';
      const { encryptApiKey } = require('./ai-crypto.util');
      const ciphertext = encryptApiKey('some-deepseek-key');
      prisma.tenant.companyAiSettings.findUnique.mockResolvedValue({ provider: 'deepseek', apiKeyEncrypted: ciphertext });

      expect(await service.getGeminiApiKey('c1')).toBe('platform-key');
    });
  });
});
