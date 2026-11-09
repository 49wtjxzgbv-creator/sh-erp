import { Injectable, Logger } from '@nestjs/common';

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

/** Persistent bottom menu (2026-11-09 user request — "ще меню типа назад пошук по артикулу по категорії по постачальниках") — always one tap away instead of only inline buttons under one message. */
export interface TelegramReplyKeyboard {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: true;
}

export type TelegramReplyMarkup = TelegramInlineKeyboard | TelegramReplyKeyboard;

export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

/**
 * Thin wrapper over Telegram's plain HTTPS Bot API — same "no SDK, plain
 * fetch" discipline as `telegram-bot/telegram-api.client.ts`, kept as its
 * own separate file (not shared) so this bot's isolation from the existing
 * production-notifications bot is total, not just at the process/role
 * level.
 *
 * Unlike that bot (webhook-driven, called by Telegram's servers), this one
 * is a standalone long-polling process — see SourcingBotService.start() —
 * so it needs `getUpdates`, which the webhook bot never does.
 */
@Injectable()
export class SourcingBotApiClient {
  private readonly logger = new Logger(SourcingBotApiClient.name);

  private get baseUrl(): string {
    const token = process.env.SOURCING_BOT_TELEGRAM_TOKEN;
    if (!token) throw new Error('SOURCING_BOT_TELEGRAM_TOKEN is not set.');
    return `https://api.telegram.org/bot${token}`;
  }

  /**
   * Long-poll for new updates. `timeoutSec` is Telegram's own long-poll
   * window (the HTTP request itself blocks server-side up to that long) —
   * NOT a client-side fetch timeout, so no AbortController here; the loop
   * in SourcingBotService just awaits this and immediately re-calls it.
   */
  async getUpdates(offset: number, timeoutSec = 30): Promise<TelegramUpdate[]> {
    try {
      const res = await fetch(`${this.baseUrl}/getUpdates?offset=${offset}&timeout=${timeoutSec}`, {
        // A little headroom over Telegram's own long-poll window so we
        // don't abort a request that's about to return empty anyway.
        signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
      });
      if (!res.ok) {
        this.logger.warn(`getUpdates failed: ${res.status}`);
        return [];
      }
      const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
      return body.ok && body.result ? body.result : [];
    } catch (err) {
      this.logger.warn(`getUpdates error: ${String(err)}`);
      return [];
    }
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: 'HTML' });
  }

  /** `photoUrl` is a plain HTTPS URL (an R2 presigned GET URL) — Telegram's own servers fetch it, no multipart upload needed. Returns success so the caller can fall back to text if a product has no usable photo. */
  async sendPhoto(chatId: string, photoUrl: string, caption: string, replyMarkup?: TelegramInlineKeyboard): Promise<boolean> {
    return this.call('sendPhoto', { chat_id: chatId, photo: photoUrl, caption, reply_markup: replyMarkup, parse_mode: 'HTML' });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  /**
   * Full-catalog export (2026-11-09 user request — "щоб генерувало файл з
   * усіма товарами там фото артикул назву всіх постачальників які є і
   * ціни які є"). A real file upload (multipart), unlike every other
   * method here (plain JSON) — Telegram's Bot API requires
   * `multipart/form-data` for `sendDocument`'s file part, not a URL this
   * time since the file is generated on the fly, not something already
   * sitting in R2. Node 20's global `fetch`/`FormData`/`Blob` handle this
   * natively, no extra dependency.
   */
  async sendDocument(chatId: string, buffer: Buffer, filename: string, caption?: string): Promise<boolean> {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      if (caption) form.append('caption', caption);
      // "доступний всім але без можливості скачати тільки перегляд"
      // (2026-11-09) — Telegram's own "protect content" flag: the
      // recipient can open/view the file in-app but the client hides its
      // save/forward controls. Not a cryptographic guarantee (a
      // sufficiently motivated person can still screenshot), but it's
      // exactly the "view, don't download" distinction Telegram itself
      // exposes, via the Bot API, no extra infrastructure needed.
      form.append('protect_content', 'true');
      form.append('document', new Blob([new Uint8Array(buffer)]), filename);
      const res = await fetch(`${this.baseUrl}/sendDocument`, { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`Telegram API sendDocument failed: ${res.status} ${text}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram API sendDocument threw: ${String(err)}`);
      return false;
    }
  }

  async editMessageText(chatId: string, messageId: number, text: string, replyMarkup?: TelegramInlineKeyboard): Promise<void> {
    await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup, parse_mode: 'HTML' });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`Telegram API ${method} failed: ${res.status} ${text}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram API ${method} threw: ${String(err)}`);
      return false;
    }
  }
}
