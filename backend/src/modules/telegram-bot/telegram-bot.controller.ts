import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Webhook receiver for Telegram's own servers — anonymous by construction
 * (no SH ERP user, no JWT), so `@Public()` (same opt-out `TenantScopeInterceptor`
 * already respects for every other pre-tenant-context route). Authenticity
 * is instead verified via the `X-Telegram-Bot-Api-Secret-Token` header,
 * which Telegram echoes back on every webhook POST once `setWebhook` was
 * called with a `secret_token` — see TelegramApiClient#setWebhook and
 * TELEGRAM_WEBHOOK_SECRET in .env.example.
 */
@ApiExcludeController()
@Controller({ path: 'telegram', version: '1' })
export class TelegramBotController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Public()
  @Post('webhook')
  async webhook(@Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined, @Body() update: unknown): Promise<{ ok: true }> {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || secretToken !== expected) {
      throw new UnauthorizedException();
    }
    await this.telegramBotService.handleUpdate(update as any);
    return { ok: true };
  }
}
