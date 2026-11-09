import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { CodedUnauthorizedException } from '../../common/api-exceptions';
import { SourcingIdentityService } from './sourcing-identity.service';

/** Telegram considers initData from a session opened long ago untrustworthy — same "a stale link shouldn't work forever" reasoning as the pairing-code TTL elsewhere in this module. */
const INIT_DATA_MAX_AGE_SECONDS = 3600;

/**
 * Validates Telegram's documented Mini App auth scheme: HMAC-SHA256 of the
 * bot token (key "WebAppData") over the alphabetically-sorted
 * `key=value` pairs (joined by `\n`, `hash` itself excluded). See
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the Telegram user id (which doubles as this bot's `chatId` for
 * any private 1:1 chat — the only kind this bot has) once validated.
 */
function validateInitData(initData: string, botToken: string): { telegramUserId: string } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(computedHash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  let telegramUserId: string;
  try {
    telegramUserId = String(JSON.parse(userRaw).id);
  } catch {
    return null;
  }
  if (!telegramUserId) return null;

  return { telegramUserId };
}

/**
 * Guards every `SourcingAppModule` route (2026-11-10 — "веб версію як
 * застосунок") — the Mini App frontend sends Telegram's own `initData`
 * (via `Telegram.WebApp.initData`) as the `X-Telegram-Init-Data` header on
 * every request instead of a JWT/cookie, since this process has no login
 * flow of its own. On success, resolves identity through the SAME
 * `SourcingIdentityService` the chat bot itself uses, so a paired user
 * sees identical access whether they're typing in the chat or tapping in
 * the Mini App.
 */
@Injectable()
export class TelegramWebAppAuthGuard implements CanActivate {
  constructor(private readonly identityService: SourcingIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const initData = request.headers['x-telegram-init-data'];
    if (!initData || typeof initData !== 'string') {
      throw new CodedUnauthorizedException('TELEGRAM_INIT_DATA_MISSING', 'Missing X-Telegram-Init-Data header.');
    }

    const botToken = process.env.SOURCING_BOT_TELEGRAM_TOKEN;
    if (!botToken) throw new Error('SOURCING_BOT_TELEGRAM_TOKEN is not set.');

    const validated = validateInitData(initData, botToken);
    if (!validated) {
      throw new CodedUnauthorizedException('TELEGRAM_INIT_DATA_INVALID', 'Invalid or expired Telegram init data.');
    }

    const identity = await this.identityService.resolveByChatId(validated.telegramUserId);
    if (!identity) {
      // Distinct code (2026-11-10) so the Mini App can show "ask your
      // admin to pair you" instead of a generic auth-error screen.
      throw new CodedUnauthorizedException('SOURCING_BOT_NOT_PAIRED', 'This Telegram account is not paired to the sourcing bot yet.');
    }

    request.sourcingIdentity = identity;
    return true;
  }
}
