import { Injectable, Logger } from '@nestjs/common';

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

/** Inline buttons attached under one specific message. */
export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

/** The persistent bottom keyboard (2026-10-01 "зроби бота розумнішим" — a main menu always one tap away, not just commands the employee has to remember/type). */
export interface TelegramReplyKeyboard {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: true;
}

export type TelegramReplyMarkup = TelegramInlineKeyboard | TelegramReplyKeyboard;

/**
 * Thin wrapper over Telegram's plain HTTPS Bot API (no SDK dependency —
 * webhook mode only needs a handful of endpoints, all trivially doable
 * with Node's global `fetch`; adding telegraf/node-telegram-bot-api would
 * be more surface than value, same "keep dependencies minimal" discipline
 * the rest of this backend follows — pdf-lib/playwright were only added
 * when a real SDK-shaped need existed).
 */
@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);

  private get baseUrl(): string {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
    return `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: 'HTML' });
  }

  /**
   * `photo` is a plain HTTPS URL (our R2 presigned download URL) —
   * Telegram's own servers fetch it, no multipart upload needed. Returns
   * whether it actually succeeded so the caller (TelegramBotService's
   * search results) can fall back to a text-only `sendMessage` for an
   * item with no usable photo, rather than silently dropping that result
   * from the list.
   */
  async sendPhoto(chatId: string, photoUrl: string, caption: string, replyMarkup?: TelegramInlineKeyboard): Promise<boolean> {
    return this.call('sendPhoto', { chat_id: chatId, photo: photoUrl, caption, reply_markup: replyMarkup, parse_mode: 'HTML' });
  }

  /** "друкує..." indicator (2026-10-01) — a small perceived-responsiveness touch while a list/search query runs. Fire-and-forget, never worth failing the real request over. */
  async sendChatAction(chatId: string, action: 'typing' = 'typing'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call('setWebhook', { url, secret_token: secretToken });
  }

  /** Powers Telegram's own "/" command menu in the chat UI — called once at startup (TelegramBotService#onModuleInit), idempotent (Telegram just overwrites the list). */
  async setMyCommands(commands: TelegramBotCommand[]): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<boolean> {
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
  }
}
