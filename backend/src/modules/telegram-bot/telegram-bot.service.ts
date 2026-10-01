import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramBotPrismaService } from '../../prisma/telegram-bot-prisma.service';
import { FilesService } from '../files/files.service';
import type { FileDomain } from '@prisma/client';
import { CreateProductionExecutionDto } from '../production/dto/production-execution.dto';
import { ProductionExecutionsService } from '../production/production-executions.service';
import { TelegramApiClient, type TelegramReplyKeyboard } from './telegram-api.client';

const MAX_ORDER_RESULTS = 10;
const LIST_PAGE_SIZE = 5;

/** The persistent bottom menu (2026-10-01 "зроби бота розумнішим" revision) — always one tap away instead of having to remember/type a command. */
const MAIN_MENU: TelegramReplyKeyboard = {
  keyboard: [[{ text: '📋 Активні замовлення' }], [{ text: '📊 Мої подання сьогодні' }, { text: '❓ Допомога' }]],
  resize_keyboard: true,
};

const HELP_TEXT =
  '🤖 <b>Як це працює</b>\n\n' +
  '1️⃣ Натисніть «📋 Активні замовлення» або напишіть частину артикулу/назви виробу.\n' +
  '2️⃣ Оберіть потрібний виріб зі списку.\n' +
  '3️⃣ Введіть кількість, яку ви виготовили.\n' +
  '4️⃣ Перевірте дані і підтвердіть — запис піде на підтвердження керівнику, і лише після цього потрапить у вашу зарплату.\n\n' +
  '📊 «Мої подання сьогодні» — побачити, що ви вже здали і на якому воно етапі.\n' +
  '/cancel — скасувати поточну дію в будь-який момент.';

interface TelegramUpdate {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

/**
 * Core FSM for the Telegram bot (2026-10-01 user request — "бот через
 * який працівники зможуть подавати виконану роботу кожного дня, вона буде
 * надходити на підтвердження і після підтвердження записуватись"; revised
 * same day — "зроби його більш розумнішим інтерактивнішим та приємнішим
 * ... зручнішим та зрозумілим"). Three steps of real conversation state:
 *
 *   1. Not paired yet -> `/start <code>` resolves the one-time pairing
 *      code generated in ERP (EmployeesService#generateTelegramPairingCode)
 *      via `TelegramBotPrismaService` (BYPASSRLS, employees-only — see
 *      that class's header comment for why this is structurally required
 *      before any tenant context exists).
 *   2. Paired, idle -> a persistent main menu (📋/📊/❓) plus a paginated,
 *      browsable list of every active (IN_PROGRESS) production order by
 *      default, or a typed article/name search. Tapping a result sets
 *      `Employee.telegramPendingProductionOrderId` and asks for a
 *      quantity.
 *   3. Quantity typed -> `telegramPendingQty` is set and a review card is
 *      shown (✅ Підтвердити / ✏️ Змінити кількість / ❌ Скасувати) BEFORE
 *      anything is actually recorded — catches a typo'd quantity instead
 *      of silently submitting it. Only ✅ Підтвердити actually calls the
 *      SAME `ProductionExecutionsService.create()` the web app's "Хід
 *      виробництва" panel uses — nothing about the confirm/payroll
 *      pipeline is duplicated, only a new way to reach `create()`.
 *
 * Every business operation (listing orders, creating the execution) runs
 * inside `PrismaService#runInTenantTransaction` once the employee's
 * companyId is known from step 1 — fully RLS-enforced from that point on,
 * same handoff shape as `LegacyImportService#completePairing` ->
 * `runHealthCheckAndPersist`.
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
      if (employee?.telegramPendingProductionOrderId || employee?.telegramPendingQty) {
        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });
      }
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
      return;
    }

    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код у HR і надішліть: /start КОД');
      return;
    }
    const paired = employee as PairedEmployee;

    // State 3 — a review card is already on screen, waiting for a button
    // tap. A freshly typed number is treated as "actually I meant this
    // qty" and silently updates the card rather than demanding they tap
    // ✏️ first; anything else is a gentle nudge back to the buttons.
    if (paired.telegramPendingQty !== null) {
      const parsed = parseQty(text);
      if (parsed !== null) {
        await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingQty: String(parsed) } });
        await this.sendConfirmationCard({ ...paired, telegramPendingQty: String(parsed) });
      } else {
        await this.telegram.sendMessage(chatId, 'Скористайтесь кнопками вище ⬆️, або надішліть нове число чи /cancel.');
      }
      return;
    }

    // State 2 — a production order is picked, waiting for a quantity.
    if (paired.telegramPendingProductionOrderId) {
      await this.handleQtyMessage(paired, text);
      return;
    }

    // State 1 — idle. Main-menu buttons/commands, then free-text search.
    if (text === '📋 Активні замовлення' || text === '/роботи' || text === '/list' || text.toLowerCase() === 'здати роботу') {
      await this.sendOrderListPage(paired, 0);
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

  private async handleCallbackQuery(callback: { id: string; data?: string; message?: { chat: { id: number } } }): Promise<void> {
    const chatId = callback.message ? String(callback.message.chat.id) : undefined;
    if (!chatId || !callback.data) {
      await this.telegram.answerCallbackQuery(callback.id);
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

    if (callback.data.startsWith('order:')) {
      const productionOrderId = callback.data.slice('order:'.length);
      await this.prisma.runInTenantTransaction({ companyId: paired.companyId, userId: paired.telegramLinkedByUserId ?? paired.id }, async (tx) => {
        const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
        if (!order || order.status !== 'IN_PROGRESS') {
          await this.telegram.answerCallbackQuery(callback.id, 'Це замовлення більше не доступне.');
          return;
        }
        const assembly = await tx.assembly.findUnique({ where: { id: order.assemblyId } });
        await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingProductionOrderId: order.id, telegramPendingQty: null } });
        await this.telegram.answerCallbackQuery(callback.id);
        await this.telegram.sendMessage(chatId, `📦 Обрано: <b>${escapeHtml(describeAssembly(assembly))}</b>\n🔢 Введіть кількість (число).`);
      });
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
      await this.telegram.sendMessage(chatId, '🔢 Введіть кількість ще раз.');
      return;
    }
    if (callback.data === 'submit:cancel') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
      return;
    }

    await this.telegram.answerCallbackQuery(callback.id);
  }

  // ============================================================
  // Pairing
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
      data: {
        telegramChatId: chatId,
        telegramLinkedAt: new Date(),
        telegramPairingCode: null,
        telegramPairingCodeExpiresAt: null,
      },
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
        telegramPendingQty: null,
      },
      0,
    );
  }

  private async findByChatId(chatId: string) {
    return this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
  }

  // ============================================================
  // Browse / search
  // ============================================================

  /**
   * Default entry point: every active production order, newest-started
   * first, `LIST_PAGE_SIZE` at a time, with ⬅️/➡️ navigation (`list:<page>`
   * callback buttons). Typing text instead still searches (`handleSearch`
   * below) — the list is the default, search is the fallback for a long
   * list, not the other way around.
   */
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
   * One message per result ("щоб при виборі виробу було також фото"):
   * Telegram's inline keyboards can't show an image per-button, so each
   * order becomes its own sendPhoto, caption = article/name + planned
   * qty, with a single "Обрати" button. Falls back to a text-only
   * sendMessage for an assembly with no ASSEMBLY_PHOTO (or whose photo
   * send fails) rather than silently dropping that result.
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
  // Quantity -> review -> submit
  // ============================================================

  private async handleQtyMessage(employee: PairedEmployee, text: string): Promise<void> {
    const qty = parseQty(text);
    if (qty === null) {
      await this.telegram.sendMessage(employee.telegramChatId, '🔢 Введіть додатне число (наприклад 5 або 5.5), або /cancel для скасування.');
      return;
    }
    await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingQty: String(qty) } });
    await this.sendConfirmationCard({ ...employee, telegramPendingQty: String(qty) });
  }

  /** The review step (2026-10-01 "зроби бота розумнішим" — catches a typo before anything is actually recorded). */
  private async sendConfirmationCard(employee: PairedEmployee & { telegramPendingQty: string }): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const order = await tx.productionOrder.findUnique({ where: { id: employee.telegramPendingProductionOrderId! } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;
      const buttons = {
        inline_keyboard: [
          [{ text: '✅ Підтвердити', callback_data: 'submit:confirm' }],
          [{ text: '✏️ Змінити кількість', callback_data: 'submit:editqty' }, { text: '❌ Скасувати', callback_data: 'submit:cancel' }],
        ],
      };
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `👀 <b>Перевірте перед підтвердженням</b>\n\n📦 ${escapeHtml(describeAssembly(assembly))}\n🔢 Кількість: <b>${employee.telegramPendingQty}</b>\n\nВсе вірно?`,
        buttons,
      );
    });
  }

  private async submitPendingExecution(employee: PairedEmployee): Promise<void> {
    const qty = employee.telegramPendingQty !== null ? Number(employee.telegramPendingQty) : null;
    const productionOrderId = employee.telegramPendingProductionOrderId;
    if (qty === null || !productionOrderId) {
      await this.telegram.sendMessage(employee.telegramChatId, 'Нічого очікує підтвердження — оберіть виріб ще раз.', MAIN_MENU);
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;

      const syntheticUser: RequestUser = { userId: employee.telegramLinkedByUserId ?? employee.id, companyId: employee.companyId, email: '', roleId: '' };
      const dto: CreateProductionExecutionDto = {
        productionOrderId,
        performedAt: new Date(),
        qtyCompleted: qty,
        method: 'SOLO',
        allocationMode: 'PERCENT',
        allocations: [{ employeeId: employee.id, percent: 100 }],
        note: 'Подано через Telegram',
      };

      try {
        const execution = await this.productionExecutionsService.create(syntheticUser, dto);
        await tx.productionExecution.update({ where: { id: execution.id }, data: { submittedViaTelegram: true } });
        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });

        // A small "скільки вже зроблено" progress touch (2026-10-01
        // "зроби бота розумнішим") — not required, just a nicer, more
        // informative confirmation than a bare "записано".
        let progressLine = '';
        if (order) {
          const confirmed = await tx.productionExecution.findMany({ where: { productionOrderId, status: 'CONFIRMED' } });
          const confirmedQty = confirmed.reduce((sum: number, e: { qtyCompleted: unknown }) => sum + Number(e.qtyCompleted ?? 0), 0);
          progressLine = `\n\nПідтверджено по цьому замовленню: ${confirmedQty} з ${Number(order.unitsPlanned)} шт.`;
        }

        await this.telegram.sendMessage(
          employee.telegramChatId,
          `✅ Подано на підтвердження!\n📦 ${escapeHtml(describeAssembly(assembly))}\n🔢 Кількість: ${qty}${progressLine}\n\nДякуємо за роботу! 💪`,
          MAIN_MENU,
        );
      } catch (err) {
        // Keep the production order selected so they can just type a new
        // number without re-picking it — only the (now-invalid) qty is
        // cleared.
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
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

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

      const lines = executions.map((e: { productionOrderId: string | null; workTaskId: string | null; qtyCompleted: unknown; status: string }) => {
        const icon = e.status === 'DRAFT' ? '⏳' : e.status === 'CONFIRMED' ? '✅' : '↩️';
        const label = e.status === 'DRAFT' ? 'очікує підтвердження' : e.status === 'CONFIRMED' ? 'підтверджено' : 'скасовано';
        let what: string;
        if (e.productionOrderId) {
          const order = orderById.get(e.productionOrderId) as { assemblyId: string } | undefined;
          const assembly = order ? assemblyById.get(order.assemblyId) : undefined;
          what = `${escapeHtml(describeAssembly(assembly))}, ${e.qtyCompleted ?? '—'} шт`;
        } else {
          const wt = workTaskById.get(e.workTaskId!) as { title: string } | undefined;
          what = escapeHtml(wt?.title ?? 'Загальна робота');
        }
        return `${icon} ${what} — ${label}`;
      });

      await this.telegram.sendMessage(employee.telegramChatId, `📊 <b>Ваші подання сьогодні:</b>\n\n${lines.join('\n')}`, MAIN_MENU);
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
  telegramPendingQty: string | null;
}

function parseQty(text: string): number | null {
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function describeAssembly(assembly: { article: string | null; name: string } | null | undefined): string {
  if (!assembly) return 'Невідомий виріб';
  return assembly.article ? `${assembly.article} — ${assembly.name}` : assembly.name;
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
