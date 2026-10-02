import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramBotPrismaService } from '../../prisma/telegram-bot-prisma.service';
import { FilesService } from '../files/files.service';
import type { FileDomain } from '@prisma/client';
import { CreateProductionExecutionDto } from '../production/dto/production-execution.dto';
import { ProductionExecutionsService } from '../production/production-executions.service';
import { TelegramApiClient, type TelegramInlineKeyboard, type TelegramReplyKeyboard } from './telegram-api.client';

const MAX_ORDER_RESULTS = 10;
const LIST_PAGE_SIZE = 5;
const COLLEAGUE_PICKER_LIMIT = 30;
const CONFIRM_PERMISSION_KEY = 'production-executions:confirm';
/** Only used to populate AsyncLocalStorage for a read-only cross-company sweep (the daily reminder) — never persisted anywhere, so any placeholder string is safe. */
const REMINDER_SYSTEM_ACTOR = 'telegram-bot-reminder';

/** The persistent bottom menu — always one tap away instead of having to remember/type a command. */
const MAIN_MENU: TelegramReplyKeyboard = {
  keyboard: [
    [{ text: '📋 Активні замовлення' }, { text: '🛠 Загальні роботи' }],
    [{ text: '📊 Мої подання сьогодні' }, { text: '❓ Допомога' }],
  ],
  resize_keyboard: true,
};

const HELP_TEXT =
  '🤖 <b>Як це працює</b>\n\n' +
  '1️⃣ Натисніть «📋 Активні замовлення» (для виробу) чи «🛠 Загальні роботи», або напишіть частину артикулу/назви.\n' +
  '2️⃣ Оберіть потрібне зі списку.\n' +
  '3️⃣ Введіть кількість (або суму — для загальної роботи).\n' +
  '4️⃣ Вкажіть, чи працювали самі, чи з колегами.\n' +
  '5️⃣ Перевірте дані і підтвердіть — запис піде на підтвердження керівнику, і лише після цього потрапить у вашу зарплату.\n\n' +
  '📊 «Мої подання сьогодні» — побачити, що ви вже здали і на якому воно етапі.\n' +
  '📷 Після підтвердження можна додати фото як підтвердження роботи.\n' +
  '/unlink — відв\'язати цей Telegram-акаунт.\n' +
  '/cancel — скасувати поточну дію в будь-який момент.';

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

interface TelegramUpdate {
  message?: { chat: { id: number }; text?: string; photo?: TelegramPhotoSize[] };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

/**
 * Core FSM for the Telegram bot (2026-10-01 — "подавати виконану роботу",
 * then "зроби його розумнішим", then "давай все окрім списку замовлень по
 * бригаді"). Conversation state, per paired Employee:
 *
 *   1. Not paired -> `/start <code>` (EmployeesService#generateTelegramPairingCode).
 *   2. Idle -> main menu: browse/search PRODUCT orders or GENERAL work
 *      tasks. Tapping a result sets telegramPendingProductionOrderId XOR
 *      telegramPendingWorkTaskId.
 *   3. Parent picked -> type a number (qty for PRODUCT, € amount for
 *      GENERAL) -> telegramPendingQty set -> "хто виконував?" (SOLO or
 *      pick colleagues, telegramPendingAllocations).
 *   4. Review card (✅/✏️/❌) BEFORE anything is actually recorded ->
 *      only ✅ calls the SAME `ProductionExecutionsService.create()` the
 *      web app's "Хід виробництва" panel uses.
 *   5. (best-effort) optional proof photo, and a push notification (with
 *      inline ✅/❌) to every company User who holds
 *      `production-executions:confirm` AND has paired their OWN Telegram
 *      (User.telegramChatId — a separate, self-service opt-in from
 *      /notifications, see UsersService).
 *
 * Every business operation runs inside `PrismaService#runInTenantTransaction`
 * once a companyId is known — fully RLS-enforced, same handoff shape as
 * `LegacyImportService#completePairing` -> `runHealthCheckAndPersist`.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly pairingPrisma: TelegramBotPrismaService,
    private readonly prisma: PrismaService,
    private readonly productionExecutionsService: ProductionExecutionsService,
    private readonly filesService: FilesService,
    private readonly telegram: TelegramApiClient,
  ) {}

  /** Powers Telegram's own "/" command autocomplete menu. Fire-and-forget on every startup — idempotent, never worth failing boot over if TELEGRAM_BOT_TOKEN isn't set yet (local dev). */
  async onModuleInit(): Promise<void> {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    try {
      await this.telegram.setMyCommands([
        { command: 'start', description: 'Почати / головне меню' },
        { command: 'list', description: 'Активні замовлення' },
        { command: 'today', description: 'Мої подання сьогодні' },
        { command: 'help', description: 'Довідка' },
        { command: 'cancel', description: 'Скасувати поточну дію' },
        { command: 'unlink', description: "Відв'язати акаунт" },
      ]);
    } catch (err) {
      this.logger.warn(`setMyCommands failed at startup: ${String(err)}`);
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }
    if (update.message?.photo && update.message.photo.length > 0) {
      await this.handlePhotoMessage(String(update.message.chat.id), update.message.photo);
      return;
    }
    if (update.message?.text !== undefined) {
      await this.handleMessage(String(update.message.chat.id), update.message.text.trim());
    }
  }

  private async handleMessage(chatId: string, text: string): Promise<void> {
    if (text.startsWith('/start')) {
      const code = text.replace('/start', '').trim();
      if (code) {
        await this.completePairing(chatId, code);
      } else {
        await this.sendWelcome(chatId);
      }
      return;
    }

    if (text === '/cancel' || text.toLowerCase() === 'скасувати') {
      const employee = await this.findByChatId(chatId);
      if (employee) await this.clearPending(employee.id);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
      return;
    }

    if (text === '/unlink') {
      await this.handleUnlinkRequest(chatId);
      return;
    }
    if (text === 'так, відв\'язати' || text === 'Так, відв\'язати') {
      await this.confirmUnlink(chatId);
      return;
    }

    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код у HR і надішліть: /start КОД');
      return;
    }
    const paired = employee as PairedEmployee;

    // State 4 — a review card is already on screen. A freshly typed
    // number updates it in place rather than demanding ✏️ first.
    if (paired.telegramPendingQty !== null) {
      const parsed = parseNumber(text);
      if (parsed !== null) {
        await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingQty: String(parsed) } });
        await this.sendConfirmationCard({ ...paired, telegramPendingQty: String(parsed) });
      } else {
        await this.telegram.sendMessage(chatId, 'Скористайтесь кнопками вище ⬆️, або надішліть нове число чи /cancel.');
      }
      return;
    }

    // State 3 — a parent (order or work task) is picked, waiting for a number.
    if (paired.telegramPendingProductionOrderId || paired.telegramPendingWorkTaskId) {
      await this.handleValueMessage(paired, text);
      return;
    }

    // State 2 — idle. Main-menu buttons/commands, then free-text search.
    if (text === '📋 Активні замовлення' || text === '/роботи' || text === '/list' || text.toLowerCase() === 'здати роботу') {
      await this.sendOrderListPage(paired, 0);
      return;
    }
    if (text === '🛠 Загальні роботи') {
      await this.sendWorkTaskListPage(paired, 0);
      return;
    }
    if (text === '📊 Мої подання сьогодні' || text === '/сьогодні' || text === '/today') {
      await this.sendTodaySubmissions(paired);
      return;
    }
    if (text === '❓ Допомога' || text === '/help' || text.toLowerCase() === 'допомога') {
      await this.telegram.sendMessage(chatId, HELP_TEXT, MAIN_MENU);
      return;
    }

    await this.handleSearch(paired, text);
  }

  private async handlePhotoMessage(chatId: string, photos: TelegramPhotoSize[]): Promise<void> {
    const employee = await this.findByChatId(chatId);
    if (!employee?.telegramAwaitingPhotoForExecutionId) return; // not expecting a photo right now — silently ignore rather than error
    const executionId = employee.telegramAwaitingPhotoForExecutionId;

    const largest = photos.reduce((best, p) => ((p.file_size ?? 0) > (best.file_size ?? 0) ? p : best), photos[0]);
    const downloaded = await this.telegram.downloadPhoto(largest.file_id);
    await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramAwaitingPhotoForExecutionId: null } });
    if (!downloaded) {
      await this.telegram.sendMessage(chatId, '⚠️ Не вдалося завантажити фото. Роботу вже записано, фото можна додати пізніше через ERP.', MAIN_MENU);
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async () => {
      await this.filesService.storeBotUploadedAsset({
        companyId: employee.companyId,
        actorUserId: employee.telegramLinkedByUserId ?? employee.id,
        domain: 'PRODUCTION_EXECUTION_PHOTO' as FileDomain,
        entityType: 'ProductionExecution',
        entityId: executionId,
        originalName: 'telegram-photo.jpg',
        mimeType: downloaded.mimeType,
        bytes: downloaded.bytes,
      });
    });
    await this.telegram.sendMessage(chatId, '📷 Фото додано, дякуємо!', MAIN_MENU);
  }

  private async handleCallbackQuery(callback: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }): Promise<void> {
    const chatId = callback.message ? String(callback.message.chat.id) : undefined;
    if (!chatId || !callback.data) {
      await this.telegram.answerCallbackQuery(callback.id);
      return;
    }

    // Supervisor approve/reject — a different identity (User, not
    // Employee), handled before the Employee lookup below since a
    // supervisor isn't necessarily an Employee at all.
    if (callback.data.startsWith('approve:') || callback.data.startsWith('reject:')) {
      await this.handleSupervisorDecision(callback.id, chatId, callback.data);
      return;
    }
    if (callback.data === 'photo:skip') {
      const employee = await this.findByChatId(chatId);
      if (employee) await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramAwaitingPhotoForExecutionId: null } });
      await this.telegram.answerCallbackQuery(callback.id);
      await this.telegram.sendMessage(chatId, '👍 Гаразд.', MAIN_MENU);
      return;
    }
    if (callback.data === 'unlink:confirm') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.confirmUnlink(chatId);
      return;
    }
    if (callback.data === 'unlink:cancel') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.telegram.sendMessage(chatId, 'Гаразд, залишаємось прив\'язаними 🙂', MAIN_MENU);
      return;
    }

    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.answerCallbackQuery(callback.id, 'Ви не прив\'язані.');
      return;
    }
    const paired = employee as PairedEmployee;

    if (callback.data.startsWith('list:')) {
      await this.telegram.answerCallbackQuery(callback.id);
      const page = Number(callback.data.slice('list:'.length));
      await this.sendOrderListPage(paired, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }
    if (callback.data.startsWith('wtlist:')) {
      await this.telegram.answerCallbackQuery(callback.id);
      const page = Number(callback.data.slice('wtlist:'.length));
      await this.sendWorkTaskListPage(paired, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }

    if (callback.data.startsWith('order:')) {
      const productionOrderId = callback.data.slice('order:'.length);
      await this.prisma.runInTenantTransaction({ companyId: paired.companyId, userId: paired.telegramLinkedByUserId ?? paired.id }, async (tx) => {
        const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
        if (!order || order.status !== 'IN_PROGRESS') {
          await this.telegram.answerCallbackQuery(callback.id, 'Це замовлення більше не доступне.');
          return;
        }
        const assembly = await tx.assembly.findUnique({ where: { id: order.assemblyId } });
        await this.pairingPrisma.employee.update({
          where: { id: paired.id },
          data: { telegramPendingProductionOrderId: order.id, telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
        });
        await this.telegram.answerCallbackQuery(callback.id);
        await this.telegram.sendMessage(chatId, `📦 Обрано: <b>${escapeHtml(describeAssembly(assembly))}</b>\n🔢 Введіть кількість (число).`);
      });
      return;
    }

    if (callback.data.startsWith('worktask:')) {
      const workTaskId = callback.data.slice('worktask:'.length);
      await this.prisma.runInTenantTransaction({ companyId: paired.companyId, userId: paired.telegramLinkedByUserId ?? paired.id }, async (tx) => {
        const workTask = await tx.workTask.findUnique({ where: { id: workTaskId } });
        if (!workTask || workTask.status !== 'OPEN') {
          await this.telegram.answerCallbackQuery(callback.id, 'Ця робота більше не доступна.');
          return;
        }
        await this.pairingPrisma.employee.update({
          where: { id: paired.id },
          data: { telegramPendingWorkTaskId: workTask.id, telegramPendingProductionOrderId: null, telegramPendingQty: null, telegramPendingAllocations: null },
        });
        await this.telegram.answerCallbackQuery(callback.id);
        await this.telegram.sendMessage(chatId, `🛠 Обрано: <b>${escapeHtml(workTask.title)}</b>\n💶 Введіть суму, € (число).`);
      });
      return;
    }

    if (callback.data === 'team:solo') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingAllocations: null } });
      await this.sendConfirmationCard({ ...paired, telegramPendingQty: paired.telegramPendingQty!, telegramPendingAllocations: null });
      return;
    }
    if (callback.data === 'team:start') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.sendColleaguePicker(paired);
      return;
    }
    if (callback.data.startsWith('team:toggle:') && callback.message) {
      const colleagueId = callback.data.slice('team:toggle:'.length);
      await this.toggleColleague(paired, colleagueId, chatId, callback.message.message_id);
      await this.telegram.answerCallbackQuery(callback.id);
      return;
    }
    if (callback.data === 'team:done') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.sendConfirmationCard({ ...paired, telegramPendingQty: paired.telegramPendingQty! });
      return;
    }
    if (callback.data === 'team:cancel') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.clearPending(paired.id);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
      return;
    }

    if (callback.data === 'submit:confirm') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.submitPendingExecution(paired);
      return;
    }
    if (callback.data === 'submit:editqty') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingQty: null } });
      await this.telegram.sendMessage(chatId, paired.telegramPendingWorkTaskId ? '💶 Введіть суму ще раз.' : '🔢 Введіть кількість ще раз.');
      return;
    }
    if (callback.data === 'submit:cancel') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.clearPending(paired.id);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
      return;
    }

    await this.telegram.answerCallbackQuery(callback.id);
  }

  private async clearPending(employeeId: string): Promise<void> {
    await this.pairingPrisma.employee.update({
      where: { id: employeeId },
      data: { telegramPendingProductionOrderId: null, telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
    });
  }

  // ============================================================
  // Pairing / unlink
  // ============================================================

  private async sendWelcome(chatId: string): Promise<void> {
    const employee = await this.findByChatId(chatId);
    if (employee) {
      await this.telegram.sendMessage(chatId, `👋 Вітаю, ${employee.fullName}!`, MAIN_MENU);
      await this.sendOrderListPage(employee as PairedEmployee, 0);
    } else {
      await this.telegram.sendMessage(chatId, 'Щоб почати, отримайте код прив\'язки у HR і надішліть: /start КОД');
    }
  }

  private async completePairing(chatId: string, rawCode: string): Promise<void> {
    const code = rawCode.toUpperCase();
    const employee = await this.pairingPrisma.employee.findFirst({ where: { telegramPairingCode: code } });
    if (!employee) {
      await this.telegram.sendMessage(chatId, '❌ Невірний код. Перевірте і спробуйте ще раз.');
      return;
    }
    if (!employee.telegramPairingCodeExpiresAt || employee.telegramPairingCodeExpiresAt.getTime() < Date.now()) {
      await this.telegram.sendMessage(chatId, '⌛ Код прострочено — попросіть HR згенерувати новий.');
      return;
    }
    const existing = await this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
    if (existing && existing.id !== employee.id) {
      await this.telegram.sendMessage(chatId, '⚠️ Цей Telegram-акаунт уже прив\'язано до іншого співробітника.');
      return;
    }

    await this.pairingPrisma.employee.update({
      where: { id: employee.id },
      data: { telegramChatId: chatId, telegramLinkedAt: new Date(), telegramPairingCode: null, telegramPairingCodeExpiresAt: null },
    });
    await this.telegram.sendMessage(chatId, `✅ Готово, ${employee.fullName}! Тепер ви можете подавати виконану роботу прямо тут.`, MAIN_MENU);
    await this.sendOrderListPage(
      {
        id: employee.id,
        companyId: employee.companyId,
        fullName: employee.fullName,
        telegramChatId: chatId,
        telegramLinkedByUserId: employee.telegramLinkedByUserId,
        telegramPendingProductionOrderId: null,
        telegramPendingWorkTaskId: null,
        telegramPendingQty: null,
        telegramPendingAllocations: null,
        telegramAwaitingPhotoForExecutionId: null,
      },
      0,
    );
  }

  /** Self-service (2026-10-01 "давай все") — no HR step required, mirrors EmployeesService#unlinkTelegram but triggerable from the bot itself. A confirmation step guards against an accidental /unlink. */
  private async handleUnlinkRequest(chatId: string): Promise<void> {
    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані.');
      return;
    }
    await this.telegram.sendMessage(chatId, `⚠️ Відв'язати цей Telegram від ${employee.fullName}? Щоб знову користуватись ботом, знадобиться новий код від HR.`, {
      inline_keyboard: [[{ text: '✅ Так, відв\'язати', callback_data: 'unlink:confirm' }, { text: '❌ Ні', callback_data: 'unlink:cancel' }]],
    });
  }

  private async confirmUnlink(chatId: string): Promise<void> {
    const employee = await this.findByChatId(chatId);
    if (!employee) return;
    await this.pairingPrisma.employee.update({
      where: { id: employee.id },
      data: {
        telegramChatId: null,
        telegramLinkedAt: null,
        telegramPendingProductionOrderId: null,
        telegramPendingWorkTaskId: null,
        telegramPendingQty: null,
        telegramPendingAllocations: null,
        telegramAwaitingPhotoForExecutionId: null,
      },
    });
    await this.telegram.sendMessage(chatId, "Відв'язано. Щоб користуватись ботом знову, попросіть у HR новий код: /start КОД");
  }

  private async findByChatId(chatId: string) {
    return this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
  }

  // ============================================================
  // Browse / search — PRODUCT (production orders)
  // ============================================================

  private async sendOrderListPage(employee: PairedEmployee, page: number): Promise<void> {
    await this.telegram.sendChatAction(employee.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' } });
      if (orders.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, '😴 Немає активних замовлень у виробництві зараз.', MAIN_MENU);
        return;
      }
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const totalPages = Math.ceil(orders.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = orders.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      await this.sendOrderResults(employee, shown, assemblyById);

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `list:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `list:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}. Або напишіть частину артикулу/назви для пошуку.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  private async handleSearch(employee: PairedEmployee, query: string): Promise<void> {
    if (!query) {
      await this.telegram.sendMessage(employee.telegramChatId, '🔍 Напишіть частину артикулу або назви виробу.');
      return;
    }

    await this.telegram.sendChatAction(employee.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, take: 200 });
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const q = query.toLowerCase();
      const matches = orders.filter((o) => {
        const a = assemblyById.get(o.assemblyId);
        if (!a) return false;
        return a.name.toLowerCase().includes(q) || (a.article?.toLowerCase().includes(q) ?? false);
      });

      if (matches.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, '🤷 Нічого не знайдено серед активних замовлень. Спробуйте інший текст.');
        return;
      }

      const shown = matches.slice(0, MAX_ORDER_RESULTS);
      const note = matches.length > shown.length ? ` (показано ${shown.length} з ${matches.length} — уточніть пошук, якщо не бачите потрібне)` : '';
      await this.telegram.sendMessage(employee.telegramChatId, `🔍 Оберіть виріб${note}:`);
      await this.sendOrderResults(employee, shown, assemblyById);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is PrismaService's extended, request-scoped transactional client; typing it precisely here would require threading TenantPrismaClient through, not worth it for a 2-line helper.
  private async loadAssembliesFor(tx: any, orders: Array<{ assemblyId: string }>): Promise<Map<string, { article: string | null; name: string }>> {
    const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
    const assemblies: Array<{ id: string; article: string | null; name: string }> = assemblyIds.length
      ? await tx.assembly.findMany({ where: { id: { in: assemblyIds } } })
      : [];
    return new Map(assemblies.map((a) => [a.id, a]));
  }

  /**
   * One message per result: Telegram's inline keyboards can't show an
   * image per-button, so each order becomes its own sendPhoto, caption =
   * article/name + planned qty, with a single select button. Falls back
   * to a text-only sendMessage for an assembly with no ASSEMBLY_PHOTO (or
   * whose photo send fails) rather than silently dropping that result.
   */
  private async sendOrderResults(
    employee: PairedEmployee,
    orders: Array<{ id: string; assemblyId: string; unitsPlanned: unknown }>,
    assemblyById: Map<string, { article: string | null; name: string }>,
  ): Promise<void> {
    if (orders.length === 0) return;
    const syntheticUser: RequestUser = { userId: employee.telegramLinkedByUserId ?? employee.id, companyId: employee.companyId, email: '', roleId: '' };
    const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
    const photosByAssembly: Record<string, Array<{ downloadUrl: string }>> = await this.filesService.listForEntities(
      syntheticUser,
      'Assembly',
      assemblyIds,
      ['ASSEMBLY_PHOTO'] satisfies FileDomain[],
    );

    for (const o of orders) {
      const a = assemblyById.get(o.assemblyId);
      const caption = `📦 ${escapeHtml(describeAssembly(a))} (${Number(o.unitsPlanned)} шт)`;
      const button = { inline_keyboard: [[{ text: '✅ Обрати', callback_data: `order:${o.id}` }]] };
      const photoUrl = photosByAssembly[o.assemblyId]?.[0]?.downloadUrl;
      const sentPhoto = photoUrl ? await this.telegram.sendPhoto(employee.telegramChatId, photoUrl, caption, button) : false;
      if (!sentPhoto) {
        await this.telegram.sendMessage(employee.telegramChatId, caption, button);
      }
    }
  }

  // ============================================================
  // Browse — GENERAL (open work tasks)
  // ============================================================

  private async sendWorkTaskListPage(employee: PairedEmployee, page: number): Promise<void> {
    await this.telegram.sendChatAction(employee.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const tasks = await tx.workTask.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
      if (tasks.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, '😴 Немає відкритих загальних робіт зараз.', MAIN_MENU);
        return;
      }

      const totalPages = Math.ceil(tasks.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = tasks.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      for (const t of shown) {
        await this.telegram.sendMessage(employee.telegramChatId, `🛠 ${escapeHtml(t.title)}`, {
          inline_keyboard: [[{ text: '✅ Обрати', callback_data: `worktask:${t.id}` }]],
        });
      }

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `wtlist:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `wtlist:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  // ============================================================
  // Value entry (qty or €) -> "хто виконував?" -> review -> submit
  // ============================================================

  private async handleValueMessage(employee: PairedEmployee, text: string): Promise<void> {
    const value = parseNumber(text);
    if (value === null) {
      const label = employee.telegramPendingWorkTaskId ? 'суму' : 'кількість';
      await this.telegram.sendMessage(employee.telegramChatId, `🔢 Введіть додатне число (${label}), або /cancel для скасування.`);
      return;
    }
    await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingQty: String(value) } });
    await this.telegram.sendMessage(employee.telegramChatId, '👥 Хто виконував цю роботу?', {
      inline_keyboard: [[{ text: '🙋 Тільки я', callback_data: 'team:solo' }, { text: '👥 Разом з колегами', callback_data: 'team:start' }]],
    });
  }

  private async sendColleaguePicker(employee: PairedEmployee, messageId?: number): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const colleagues: Array<{ id: string; fullName: string }> = await tx.employee.findMany({
        where: { status: 'ACTIVE', id: { not: employee.id } },
        orderBy: { fullName: 'asc' },
        take: COLLEAGUE_PICKER_LIMIT,
        select: { id: true, fullName: true },
      });
      if (colleagues.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, 'Інших активних співробітників не знайдено.');
        await this.sendConfirmationCard({ ...employee, telegramPendingQty: employee.telegramPendingQty!, telegramPendingAllocations: null });
        return;
      }
      const selected = parseAllocations(employee.telegramPendingAllocations);
      const text = '👥 Оберіть колег (торкніться, щоб додати/прибрати), потім «✅ Готово»:';
      const keyboard = buildColleagueKeyboard(colleagues, selected);
      if (messageId) {
        await this.telegram.editMessageText(employee.telegramChatId, messageId, text, keyboard);
      } else {
        await this.telegram.sendMessage(employee.telegramChatId, text, keyboard);
      }
    });
  }

  private async toggleColleague(employee: PairedEmployee, colleagueId: string, chatId: string, messageId: number): Promise<void> {
    const selected = new Set(parseAllocations(employee.telegramPendingAllocations));
    if (selected.has(colleagueId)) selected.delete(colleagueId);
    else selected.add(colleagueId);
    const updated = await this.pairingPrisma.employee.update({
      where: { id: employee.id },
      data: { telegramPendingAllocations: JSON.stringify([...selected]) },
    });
    await this.sendColleaguePicker({ ...employee, telegramPendingAllocations: updated.telegramPendingAllocations }, messageId);
  }

  /** The review step — catches a typo/mistake before anything is actually recorded. */
  private async sendConfirmationCard(employee: PairedEmployee & { telegramPendingQty: string }): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const description = await this.describePendingParent(tx, employee);
      const valueLabel = employee.telegramPendingWorkTaskId ? 'Сума' : 'Кількість';
      const valueSuffix = employee.telegramPendingWorkTaskId ? ' €' : '';

      const colleagueIds = parseAllocations(employee.telegramPendingAllocations);
      let participantsLine = '';
      if (colleagueIds.length > 0) {
        const colleagues: Array<{ fullName: string }> = await tx.employee.findMany({ where: { id: { in: colleagueIds } }, select: { fullName: true } });
        participantsLine = `\n👥 Разом з: ${colleagues.map((c) => escapeHtml(c.fullName)).join(', ')}`;
      }

      const buttons: TelegramInlineKeyboard = {
        inline_keyboard: [
          [{ text: '✅ Підтвердити', callback_data: 'submit:confirm' }],
          [{ text: '✏️ Змінити', callback_data: 'submit:editqty' }, { text: '❌ Скасувати', callback_data: 'submit:cancel' }],
        ],
      };
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `👀 <b>Перевірте перед підтвердженням</b>\n\n${description}\n${valueLabel}: <b>${employee.telegramPendingQty}${valueSuffix}</b>${participantsLine}\n\nВсе вірно?`,
        buttons,
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async describePendingParent(tx: any, employee: PairedEmployee): Promise<string> {
    if (employee.telegramPendingProductionOrderId) {
      const order = await tx.productionOrder.findUnique({ where: { id: employee.telegramPendingProductionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;
      return `📦 ${escapeHtml(describeAssembly(assembly))}`;
    }
    const workTask = await tx.workTask.findUnique({ where: { id: employee.telegramPendingWorkTaskId! } });
    return `🛠 ${escapeHtml(workTask?.title ?? 'Загальна робота')}`;
  }

  private async submitPendingExecution(employee: PairedEmployee): Promise<void> {
    const value = employee.telegramPendingQty !== null ? Number(employee.telegramPendingQty) : null;
    const productionOrderId = employee.telegramPendingProductionOrderId;
    const workTaskId = employee.telegramPendingWorkTaskId;
    if (value === null || (!productionOrderId && !workTaskId)) {
      await this.telegram.sendMessage(employee.telegramChatId, 'Нічого очікує підтвердження — оберіть ще раз.', MAIN_MENU);
      return;
    }
    const colleagueIds = parseAllocations(employee.telegramPendingAllocations);
    const participantIds = [employee.id, ...colleagueIds];
    const percent = round2(100 / participantIds.length);

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const description = await this.describePendingParent(tx, employee);
      const syntheticUser: RequestUser = { userId: employee.telegramLinkedByUserId ?? employee.id, companyId: employee.companyId, email: '', roleId: '' };
      const dto: CreateProductionExecutionDto = {
        productionOrderId: productionOrderId ?? undefined,
        workTaskId: workTaskId ?? undefined,
        performedAt: new Date(),
        qtyCompleted: productionOrderId ? value : undefined,
        totalAmount: workTaskId ? value : undefined,
        method: participantIds.length > 1 ? 'MULTI_WORKER' : 'SOLO',
        allocationMode: 'PERCENT',
        allocations: participantIds.map((employeeId) => ({ employeeId, percent })),
        note: 'Подано через Telegram',
      };

      try {
        const execution = await this.productionExecutionsService.create(syntheticUser, dto);
        await tx.productionExecution.update({ where: { id: execution.id }, data: { submittedViaTelegram: true } });
        await this.clearPending(employee.id);
        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramAwaitingPhotoForExecutionId: execution.id } });

        let progressLine = '';
        if (productionOrderId) {
          const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
          if (order) {
            const confirmed = await tx.productionExecution.findMany({ where: { productionOrderId, status: 'CONFIRMED' } });
            const confirmedQty = confirmed.reduce((sum: number, e: { qtyCompleted: unknown }) => sum + Number(e.qtyCompleted ?? 0), 0);
            progressLine = `\n\nПідтверджено по цьому замовленню: ${confirmedQty} з ${Number(order.unitsPlanned)} шт.`;
          }
        }

        await this.telegram.sendMessage(
          employee.telegramChatId,
          `✅ Подано на підтвердження!\n${description}${progressLine}\n\nДякуємо за роботу! 💪`,
          MAIN_MENU,
        );
        await this.telegram.sendMessage(employee.telegramChatId, '📷 Бажаєте додати фото підтвердження?', {
          inline_keyboard: [[{ text: 'Пропустити', callback_data: 'photo:skip' }]],
        });

        await this.notifySupervisors(tx, employee, execution.id, description, value, productionOrderId ? 'шт' : '€');
        for (const colleagueId of colleagueIds) {
          const colleague = await tx.employee.findUnique({ where: { id: colleagueId } });
          if (colleague?.telegramChatId) {
            await this.telegram.sendMessage(colleague.telegramChatId, `ℹ️ ${escapeHtml(employee.fullName)} подав(-ла) спільну роботу, де ви також брали участь:\n${description}`);
          }
        }
      } catch (err) {
        // Keep the parent selected so they can just type a new number
        // without re-picking it — only the (now-invalid) value is cleared.
        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingQty: null } });
        await this.telegram.sendMessage(employee.telegramChatId, `⚠️ ${escapeHtml(extractErrorMessage(err))}\n🔢 Введіть інше число або /cancel.`);
      }
    });
  }

  // ============================================================
  // "Мої подання сьогодні"
  // ============================================================

  private async sendTodaySubmissions(employee: PairedEmployee): Promise<void> {
    await this.telegram.sendChatAction(employee.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const { startOfDay, endOfDay } = todayRange();

      const executions = await tx.productionExecution.findMany({
        where: { performedAt: { gte: startOfDay, lt: endOfDay }, allocations: { some: { employeeId: employee.id } } },
        orderBy: { createdAt: 'desc' },
      });

      if (executions.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, '📭 Сьогодні ви ще нічого не подавали. Натисніть «📋 Активні замовлення», щоб почати.', MAIN_MENU);
        return;
      }

      const productionOrderIds = executions.map((e: { productionOrderId: string | null }) => e.productionOrderId).filter((id: string | null): id is string => Boolean(id));
      const orders = productionOrderIds.length ? await tx.productionOrder.findMany({ where: { id: { in: productionOrderIds } } }) : [];
      const orderById = new Map(orders.map((o: { id: string }) => [o.id, o]));
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const workTaskIds = executions.map((e: { workTaskId: string | null }) => e.workTaskId).filter((id: string | null): id is string => Boolean(id));
      const workTasks = workTaskIds.length ? await tx.workTask.findMany({ where: { id: { in: workTaskIds } } }) : [];
      const workTaskById = new Map(workTasks.map((w: { id: string; title: string }) => [w.id, w]));

      const lines = executions.map((e: { productionOrderId: string | null; workTaskId: string | null; qtyCompleted: unknown; totalAmount: unknown; status: string }) => {
        const icon = e.status === 'DRAFT' ? '⏳' : e.status === 'CONFIRMED' ? '✅' : '↩️';
        const label = e.status === 'DRAFT' ? 'очікує підтвердження' : e.status === 'CONFIRMED' ? 'підтверджено' : 'скасовано';
        let what: string;
        if (e.productionOrderId) {
          const order = orderById.get(e.productionOrderId) as { assemblyId: string } | undefined;
          const assembly = order ? assemblyById.get(order.assemblyId) : undefined;
          what = `${escapeHtml(describeAssembly(assembly))}, ${e.qtyCompleted ?? '—'} шт`;
        } else {
          const wt = workTaskById.get(e.workTaskId!) as { title: string } | undefined;
          what = `${escapeHtml(wt?.title ?? 'Загальна робота')}, ${Number(e.totalAmount)} €`;
        }
        return `${icon} ${what} — ${label}`;
      });

      await this.telegram.sendMessage(employee.telegramChatId, `📊 <b>Ваші подання сьогодні:</b>\n\n${lines.join('\n')}`, MAIN_MENU);
    });
  }

  // ============================================================
  // Supervisor notification + approve/reject
  // ============================================================

  /** "Сповіщення керівнику в Telegram" (2026-10-01) — every company User holding `production-executions:confirm` who has separately opted in (User.telegramChatId, self-service via /notifications — see UsersService) gets pushed this bot-submitted DRAFT with inline ✅/❌. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async notifySupervisors(tx: any, submitter: PairedEmployee, executionId: string, description: string, value: number, unit: string): Promise<void> {
    const memberships: Array<{ userId: string; roleId: string }> = await tx.companyMembership.findMany({ where: {} });
    if (memberships.length === 0) return;
    const roleIds = [...new Set(memberships.map((m) => m.roleId))];
    const roles: Array<{ id: string; permissions: Array<{ permission: { key: string } }> }> = await tx.role.findMany({
      where: { id: { in: roleIds } },
      include: { permissions: { include: { permission: true } } },
    });
    const allowedRoleIds = new Set(roles.filter((r) => r.permissions.some((rp) => rp.permission.key === CONFIRM_PERMISSION_KEY)).map((r) => r.id));
    const supervisorUserIds = memberships.filter((m) => allowedRoleIds.has(m.roleId)).map((m) => m.userId);
    if (supervisorUserIds.length === 0) return;

    const supervisors: Array<{ telegramChatId: string | null }> = await tx.user.findMany({ where: { id: { in: supervisorUserIds } } });
    const buttons: TelegramInlineKeyboard = {
      inline_keyboard: [[
        { text: '✅ Підтвердити', callback_data: `approve:${submitter.companyId}:${executionId}` },
        { text: '❌ Відхилити', callback_data: `reject:${submitter.companyId}:${executionId}` },
      ]],
    };
    for (const supervisor of supervisors) {
      if (!supervisor.telegramChatId) continue;
      await this.telegram.sendMessage(
        supervisor.telegramChatId,
        `🔔 <b>Нове подання очікує підтвердження</b>\n👤 ${escapeHtml(submitter.fullName)}\n${description}\n🔢 ${value} ${unit}`,
        buttons,
      );
    }
  }

  private async handleSupervisorDecision(callbackId: string, chatId: string, data: string): Promise<void> {
    const [action, companyId, executionId] = data.split(':');
    const supervisorUser = await this.pairingPrisma.user.findFirst({ where: { telegramChatId: chatId } });
    if (!supervisorUser) {
      await this.telegram.answerCallbackQuery(callbackId, 'Ви не підписані на сповіщення.');
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId, userId: supervisorUser.id }, async (tx) => {
      const allowed = await this.userHasPermission(tx, supervisorUser.id, CONFIRM_PERMISSION_KEY);
      if (!allowed) {
        await this.telegram.answerCallbackQuery(callbackId, 'У вас немає прав підтверджувати.');
        return;
      }
      const execution = await tx.productionExecution.findUnique({ where: { id: executionId }, include: { allocations: true } });
      if (!execution || execution.status !== 'DRAFT') {
        await this.telegram.answerCallbackQuery(callbackId, 'Це подання вже оброблено.');
        return;
      }

      const realUser: RequestUser = { userId: supervisorUser.id, companyId, email: supervisorUser.email, roleId: '' };
      try {
        if (action === 'approve') {
          await this.productionExecutionsService.confirm(realUser, executionId);
          await this.telegram.answerCallbackQuery(callbackId, 'Підтверджено ✅');
          await this.telegram.sendMessage(chatId, '✅ Підтверджено.');
        } else {
          await this.productionExecutionsService.remove(realUser, executionId);
          await this.telegram.answerCallbackQuery(callbackId, 'Відхилено ❌');
          await this.telegram.sendMessage(chatId, '❌ Відхилено.');
        }
        for (const allocation of execution.allocations as Array<{ employeeId: string }>) {
          const employee = await tx.employee.findUnique({ where: { id: allocation.employeeId } });
          if (employee?.telegramChatId) {
            await this.telegram.sendMessage(
              employee.telegramChatId,
              action === 'approve' ? '✅ Вашу роботу підтверджено!' : '❌ Ваше подання відхилено. За деталями зверніться до керівника.',
            );
          }
        }
      } catch (err) {
        await this.telegram.answerCallbackQuery(callbackId, extractErrorMessage(err));
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async userHasPermission(tx: any, userId: string, permissionKey: string): Promise<boolean> {
    const membership = await tx.companyMembership.findFirst({ where: { userId } });
    if (!membership) return false;
    const role = await tx.role.findUnique({ where: { id: membership.roleId }, include: { permissions: { include: { permission: true } } } });
    return role?.permissions.some((rp: { permission: { key: string } }) => rp.permission.key === permissionKey) ?? false;
  }

  // ============================================================
  // Daily "хто ще нічого не подав" reminder
  // ============================================================

  /**
   * 16:00 UTC ≈ end of a Europe/Kyiv workday (18:00–19:00 local, depending
   * on DST) — a disclosed simplification, not true per-company-timezone
   * scheduling (every `Company` has its own `timezone` field, but a single
   * process-wide cron can only fire at one UTC instant; a real per-company
   * schedule would need a job-per-company-offset, out of scope for this
   * pass — same "disclosed gap, not silently faked" spirit as
   * low-stock-digest.service.ts's own header comment).
   */
  @Cron('0 16 * * *')
  async sendDailyReminders(): Promise<void> {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    try {
      const companies = await this.pairingPrisma.company.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      for (const company of companies) {
        await this.remindCompanyEmployees(company.id);
      }
    } catch (err) {
      this.logger.warn(`sendDailyReminders failed: ${String(err)}`);
    }
  }

  private async remindCompanyEmployees(companyId: string): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId, userId: REMINDER_SYSTEM_ACTOR }, async (tx) => {
      const employees: Array<{ id: string; telegramChatId: string | null }> = await tx.employee.findMany({
        where: { status: 'ACTIVE', telegramChatId: { not: null } },
      });
      if (employees.length === 0) return;

      const { startOfDay, endOfDay } = todayRange();
      const executions: Array<{ allocations: Array<{ employeeId: string }> }> = await tx.productionExecution.findMany({
        where: { performedAt: { gte: startOfDay, lt: endOfDay } },
        include: { allocations: true },
      });
      const submittedToday = new Set(executions.flatMap((e) => e.allocations.map((a) => a.employeeId)));

      for (const employee of employees) {
        if (submittedToday.has(employee.id) || !employee.telegramChatId) continue;
        await this.telegram.sendMessage(
          employee.telegramChatId,
          '👋 Привіт! Сьогодні ви ще не подали жодної виконаної роботи. Якщо щось зробили — не забудьте здати 🙂',
          MAIN_MENU,
        );
      }
    });
  }
}

interface PairedEmployee {
  id: string;
  companyId: string;
  fullName: string;
  telegramChatId: string;
  telegramLinkedByUserId: string | null;
  telegramPendingProductionOrderId: string | null;
  telegramPendingWorkTaskId: string | null;
  telegramPendingQty: string | null;
  telegramPendingAllocations: string | null;
  telegramAwaitingPhotoForExecutionId: string | null;
}

function parseNumber(text: string): number | null {
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseAllocations(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function buildColleagueKeyboard(colleagues: Array<{ id: string; fullName: string }>, selected: string[]): TelegramInlineKeyboard {
  const selectedSet = new Set(selected);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < colleagues.length; i += 2) {
    rows.push(
      colleagues.slice(i, i + 2).map((c) => ({ text: `${selectedSet.has(c.id) ? '✅ ' : ''}${c.fullName}`, callback_data: `team:toggle:${c.id}` })),
    );
  }
  rows.push([{ text: `✅ Готово (${selected.length})`, callback_data: 'team:done' }, { text: '❌ Скасувати', callback_data: 'team:cancel' }]);
  return { inline_keyboard: rows };
}

function describeAssembly(assembly: { article: string | null; name: string } | null | undefined): string {
  if (!assembly) return 'Невідомий виріб';
  return assembly.article ? `${assembly.article} — ${assembly.name}` : assembly.name;
}

function todayRange(): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  return { startOfDay, endOfDay };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      return String((body as { message: unknown }).message);
    }
  }
  return 'Сталася помилка. Спробуйте ще раз.';
}
