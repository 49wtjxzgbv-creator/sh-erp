import { createHmac } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { TelegramWebAppAuthGuard } from './telegram-webapp-auth.guard';

const BOT_TOKEN = '123456:test-token';

/** Builds a real, correctly-signed Telegram Mini App initData string, mirroring exactly what the guard itself verifies. */
function buildInitData(overrides: { telegramUserId?: string | number; authDate?: number } = {}): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify({ id: overrides.telegramUserId ?? 999, first_name: 'Test' }));
  params.set('auth_date', String(overrides.authDate ?? Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAABBB');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function contextWithHeader(initData: string | undefined): ExecutionContext {
  const request: any = { headers: initData !== undefined ? { 'x-telegram-init-data': initData } : {} };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('TelegramWebAppAuthGuard (2026-11-10 — Mini App auth)', () => {
  let identityService: any;
  let guard: TelegramWebAppAuthGuard;

  beforeEach(() => {
    process.env.SOURCING_BOT_TELEGRAM_TOKEN = BOT_TOKEN;
    identityService = { resolveByChatId: jest.fn().mockResolvedValue({ userId: 'u1', companyId: 'c1', fullName: 'Іван', isAdmin: false }) };
    guard = new TelegramWebAppAuthGuard(identityService);
  });

  it('rejects a request with no X-Telegram-Init-Data header', async () => {
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toMatchObject({ response: { code: 'TELEGRAM_INIT_DATA_MISSING' } });
  });

  it('rejects a tampered/invalid signature', async () => {
    const tampered = buildInitData().replace(/user=[^&]+/, `user=${encodeURIComponent(JSON.stringify({ id: 42 }))}`);
    await expect(guard.canActivate(contextWithHeader(tampered))).rejects.toMatchObject({ response: { code: 'TELEGRAM_INIT_DATA_INVALID' } });
  });

  it('rejects an expired auth_date', async () => {
    const stale = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 7200 });
    await expect(guard.canActivate(contextWithHeader(stale))).rejects.toMatchObject({ response: { code: 'TELEGRAM_INIT_DATA_INVALID' } });
  });

  it('rejects a valid signature from a chat that is not paired', async () => {
    identityService.resolveByChatId.mockResolvedValue(null);
    await expect(guard.canActivate(contextWithHeader(buildInitData()))).rejects.toMatchObject({ response: { code: 'SOURCING_BOT_NOT_PAIRED' } });
  });

  it('accepts a valid, paired signature and attaches the resolved identity to the request', async () => {
    const request: any = { headers: { 'x-telegram-init-data': buildInitData({ telegramUserId: 999 }) } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(identityService.resolveByChatId).toHaveBeenCalledWith('999');
    expect(request.sourcingIdentity).toEqual({ userId: 'u1', companyId: 'c1', fullName: 'Іван', isAdmin: false });
  });
});
