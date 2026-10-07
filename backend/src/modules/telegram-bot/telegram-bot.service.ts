import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramBotPrismaService } from '../../prisma/telegram-bot-prisma.service';
import { FilesService } from '../files/files.service';
import type { FileDomain } from '@prisma/client';
import { CreateProductionExecutionDto } from '../production/dto/production-execution.dto';
import { ProductionExecutionsService } from '../production/production-executions.service';
import { ProductionOrdersService } from '../production/production-orders.service';
import { TelegramApiClient, type TelegramInlineKeyboard, type TelegramReplyKeyboard } from './telegram-api.client';

const MAX_ORDER_RESULTS = 10;
const LIST_PAGE_SIZE = 5;
const COLLEAGUE_PICKER_LIMIT = 30;
const CONFIRM_PERMISSION_KEY = 'production-executions:confirm';
/** "Подати роботу за іншого працівника" (2026-10-05) — gates the admin submit-for-employee flow, same permission the web app's confirmations queue "Записати виконання" action requires. */
const RECORD_PERMISSION_KEY = 'production-executions:record';
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
  '👥 Якщо працювали з колегами, за замовчуванням сума ділиться рівно — кнопка «✏️ Відсотки» на картці перевірки дозволяє задати інший розподіл.\n' +
  '📊 «Мої подання сьогодні» — побачити, що ви вже здали і на якому воно етапі.\n' +
  '📷 Після підтвердження можна додати фото як підтвердження роботи.\n' +
  '/unlink — відв\'язати цей Telegram-акаунт.\n' +
  '/cancel — скасувати поточну дію в будь-який момент.';

/**
 * "Подати роботу за іншого працівника" + "Підтвердження прямо в режимі
 * адміна" (2026-10-05 user requests): a paired User (/notifications page)
 * holding `production-executions:record` and/or `production-executions:
 * confirm` gets this menu instead of the Employee one above — distinct
 * identity, distinct FSM state (User.telegramAdminPending*, never
 * Employee's own fields). Rows are built conditionally per-permission —
 * see buildAdminMenu and PairedAdminUser.canRecord/canConfirm.
 */
function buildAdminMenu(admin: { canRecord: boolean; canConfirm: boolean }): TelegramReplyKeyboard {
  const topRow: Array<{ text: string }> = [];
  if (admin.canRecord) topRow.push({ text: '👤 Подати роботу за працівника' });
  if (admin.canConfirm) topRow.push({ text: '📥 На підтвердження' });

  const secondRow: Array<{ text: string }> = [];
  if (admin.canRecord) secondRow.push({ text: '📊 Сьогодні записано мною' });
  secondRow.push({ text: '📈 Підсумок по працівнику' });

  const thirdRow: Array<{ text: string }> = [{ text: '🔍 Перевірити готовність' }];

  const keyboard = [topRow, secondRow, thirdRow, [{ text: '❓ Допомога' }]].filter((row) => row.length > 0);
  return { keyboard, resize_keyboard: true };
}

function buildAdminHelpText(admin: { canRecord: boolean; canConfirm: boolean }): string {
  const sections: string[] = ['🤖 <b>Можливості адміністратора</b>\n'];
  if (admin.canRecord) {
    sections.push(
      '👤 <b>Подати роботу за працівника</b>\n' +
        '1️⃣ Оберіть одного чи кількох працівників («✅ Готово»).\n' +
        '2️⃣ Оберіть виріб (замовлення) чи загальну роботу, або напишіть частину артикулу/назви.\n' +
        '3️⃣ Введіть кількість (або суму).\n' +
        '4️⃣ Перевірте і підтвердіть — запис піде на підтвердження керівнику. Якщо обрано кількох, за замовчуванням сума ділиться рівно — «✏️ Відсотки» дозволяє задати інший розподіл.',
    );
  }
  if (admin.canConfirm) {
    sections.push('📥 <b>На підтвердження</b> — список усіх подань, що очікують, із кнопками ✅/❌ прямо тут (не чекаючи push-сповіщення).');
  }
  if (admin.canRecord) {
    sections.push('📊 <b>Сьогодні записано мною</b> — що саме ви наподавали за інших працівників сьогодні.');
  }
  sections.push('📈 <b>Підсумок по працівнику</b> — скільки хтось наробив/заробив за обраний період, без заходу в ERP.');
  sections.push('🔍 <b>Перевірити готовність</b> — чи вистачає компонентів і підвиробів, щоб запустити заплановану партію, і чого саме не хватає, якщо ні.');
  sections.push('/cancel — скасувати поточну дію в будь-який момент.');
  return sections.join('\n\n');
}

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
    private readonly productionOrdersService: ProductionOrdersService,
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
      if (employee) {
        await this.clearPending(employee.id);
        await this.telegram.sendMessage(chatId, '❌ Скасовано.', MAIN_MENU);
        return;
      }
      const admin = await this.findAdminByChatId(chatId);
      if (admin) {
        await this.clearAdminPending(admin.id);
        await this.telegram.sendMessage(chatId, '❌ Скасовано.', buildAdminMenu(admin));
        return;
      }
      await this.telegram.sendMessage(chatId, '❌ Скасовано.');
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
    if (employee) {
      await this.handleEmployeeMessage(employee as PairedEmployee, text);
      return;
    }

    const admin = await this.findAdminByChatId(chatId);
    if (admin) {
      await this.handleAdminMessage(admin, text);
      return;
    }

    // Paired as a User for supervisor notifications only (no
    // production-executions:record) — a clearer message than the
    // Employee-oriented "get a code from HR" fallback below.
    const plainUser = await this.pairingPrisma.user.findFirst({ where: { telegramChatId: chatId } });
    if (plainUser) {
      await this.telegram.sendMessage(chatId, 'Цей акаунт підписаний на сповіщення керівника. Команди подачі роботи тут недоступні.');
      return;
    }

    await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код у HR і надішліть: /start КОД');
  }

  private async handleEmployeeMessage(employee: PairedEmployee, text: string): Promise<void> {
    const chatId = employee.telegramChatId;
    const paired = employee;

    // "✏️ Відсотки" asked for a number list; this text IS that list —
    // checked before the qty-review state below since it can only be true
    // once telegramPendingQty is already set (entered from the review card).
    if (paired.telegramAwaitingPercentsInput) {
      await this.handlePercentsMessage(paired, text);
      return;
    }

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
    if (employee?.telegramAwaitingPhotoForExecutionId) {
      await this.storeAwaitingPhoto(
        chatId,
        photos,
        employee.companyId,
        employee.telegramAwaitingPhotoForExecutionId,
        employee.telegramLinkedByUserId ?? employee.id,
        () => this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramAwaitingPhotoForExecutionId: null } }),
        MAIN_MENU,
      );
      return;
    }

    const admin = await this.findAdminByChatId(chatId);
    if (admin?.telegramAdminAwaitingPhotoForExecutionId) {
      await this.storeAwaitingPhoto(
        chatId,
        photos,
        admin.companyId,
        admin.telegramAdminAwaitingPhotoForExecutionId,
        admin.id,
        () => this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingPhotoForExecutionId: null } }),
        buildAdminMenu(admin),
      );
      return;
    }
    // not expecting a photo right now — silently ignore rather than error
  }

  private async storeAwaitingPhoto(
    chatId: string,
    photos: TelegramPhotoSize[],
    companyId: string,
    executionId: string,
    actorUserId: string,
    clearAwaiting: () => Promise<unknown>,
    menu: TelegramReplyKeyboard,
  ): Promise<void> {
    const largest = photos.reduce((best, p) => ((p.file_size ?? 0) > (best.file_size ?? 0) ? p : best), photos[0]);
    const downloaded = await this.telegram.downloadPhoto(largest.file_id);
    await clearAwaiting();
    if (!downloaded) {
      await this.telegram.sendMessage(chatId, '⚠️ Не вдалося завантажити фото. Роботу вже записано, фото можна додати пізніше через ERP.', menu);
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async () => {
      await this.filesService.storeBotUploadedAsset({
        companyId,
        actorUserId,
        domain: 'PRODUCTION_EXECUTION_PHOTO' as FileDomain,
        entityType: 'ProductionExecution',
        entityId: executionId,
        originalName: 'telegram-photo.jpg',
        mimeType: downloaded.mimeType,
        bytes: downloaded.bytes,
      });
    });
    await this.telegram.sendMessage(chatId, '📷 Фото додано, дякуємо!', menu);
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
    // Admin "submit for employee" flow — a different identity (User, not
    // Employee), same reason approve/reject is checked before the Employee
    // lookup below. Namespaced `admin:` so it can never collide with the
    // Employee flow's own callback_data.
    if (callback.data.startsWith('admin:')) {
      await this.handleAdminCallback(callback.id, chatId, callback.data, callback.message?.message_id);
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
      await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingAllocations: null, telegramPendingPercents: null } });
      await this.sendConfirmationCard({ ...paired, telegramPendingQty: paired.telegramPendingQty!, telegramPendingAllocations: null, telegramPendingPercents: null });
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
      // The colleague set may have just changed — any previously-entered
      // custom percents are keyed by a potentially different participant
      // list now, so they're cleared here, not just at submit time.
      await this.pairingPrisma.employee.update({ where: { id: paired.id }, data: { telegramPendingPercents: null } });
      await this.sendConfirmationCard({ ...paired, telegramPendingQty: paired.telegramPendingQty!, telegramPendingPercents: null });
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
    if (callback.data === 'submit:editpercents') {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.promptForPercents(paired);
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
      data: {
        telegramPendingProductionOrderId: null,
        telegramPendingWorkTaskId: null,
        telegramPendingQty: null,
        telegramPendingAllocations: null,
        telegramPendingPercents: null,
        telegramAwaitingPercentsInput: false,
      },
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
      return;
    }
    const admin = await this.findAdminByChatId(chatId);
    if (admin) {
      await this.telegram.sendMessage(chatId, `👋 Вітаю, ${admin.fullName}! Ви можете подавати виконану роботу за інших працівників.`, buildAdminMenu(admin));
      return;
    }
    const plainUser = await this.pairingPrisma.user.findFirst({ where: { telegramChatId: chatId } });
    if (plainUser) {
      await this.telegram.sendMessage(chatId, `👋 Вітаю, ${plainUser.fullName}! Цей акаунт підписаний на сповіщення керівника.`);
      return;
    }
    await this.telegram.sendMessage(chatId, 'Щоб почати, отримайте код прив\'язки у HR і надішліть: /start КОД');
  }

  private async completePairing(chatId: string, rawCode: string): Promise<void> {
    const code = rawCode.toUpperCase();
    const employee = await this.pairingPrisma.employee.findFirst({ where: { telegramPairingCode: code } });
    if (employee) {
      await this.completeEmployeePairing(chatId, employee);
      return;
    }
    const user = await this.pairingPrisma.user.findFirst({ where: { telegramPairingCode: code } });
    if (user) {
      await this.completeUserPairing(chatId, user);
      return;
    }
    await this.telegram.sendMessage(chatId, '❌ Невірний код. Перевірте і спробуйте ще раз.');
  }

  private async completeEmployeePairing(
    chatId: string,
    employee: { id: string; companyId: string; fullName: string; telegramLinkedByUserId: string | null; telegramPairingCodeExpiresAt: Date | null },
  ): Promise<void> {
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
        telegramPendingPercents: null,
        telegramAwaitingPercentsInput: false,
        telegramAwaitingPhotoForExecutionId: null,
      },
      0,
    );
  }

  /**
   * "Сповіщення керівнику в Telegram" pairing (2026-10-01) was built with a
   * code-generation side (UsersService#generateTelegramPairingCode,
   * /notifications page) but this consumption side was never wired up —
   * `/start CODE` only ever checked Employee.telegramPairingCode, so no
   * User had ever actually completed pairing (2026-10-05 fix, found while
   * building the admin submit-for-employee flow, which depends on this
   * same pairing). Mirrors completeEmployeePairing's shape; additionally
   * live-checks `production-executions:record` right after pairing so the
   * welcome message can tell the user whether they also got the admin
   * submit-for-employee menu, or just notifications.
   */
  private async completeUserPairing(
    chatId: string,
    user: { id: string; fullName: string; telegramPairingCodeExpiresAt: Date | null },
  ): Promise<void> {
    if (!user.telegramPairingCodeExpiresAt || user.telegramPairingCodeExpiresAt.getTime() < Date.now()) {
      await this.telegram.sendMessage(chatId, '⌛ Код прострочено — згенеруйте новий у розділі «Сповіщення».');
      return;
    }
    const existing = await this.pairingPrisma.user.findFirst({ where: { telegramChatId: chatId } });
    if (existing && existing.id !== user.id) {
      await this.telegram.sendMessage(chatId, '⚠️ Цей Telegram-акаунт уже прив\'язано до іншого користувача.');
      return;
    }

    await this.pairingPrisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: chatId, telegramPairingCode: null, telegramPairingCodeExpiresAt: null },
    });

    const membership = await this.pairingPrisma.companyMembership.findFirst({ where: { userId: user.id } });
    const [canRecord, canConfirm] = membership
      ? await this.prisma.runInTenantTransaction({ companyId: membership.companyId, userId: user.id }, (tx) =>
          Promise.all([this.userHasPermission(tx, user.id, RECORD_PERMISSION_KEY), this.userHasPermission(tx, user.id, CONFIRM_PERMISSION_KEY)]),
        )
      : [false, false];

    if (canRecord || canConfirm) {
      const capabilities = [canConfirm && 'підтверджувати подання', canRecord && 'подавати роботу за інших працівників'].filter(Boolean).join(' і ');
      await this.telegram.sendMessage(chatId, `✅ Готово, ${user.fullName}! Тепер ви можете ${capabilities} прямо тут.`, buildAdminMenu({ canRecord, canConfirm }));
    } else {
      await this.telegram.sendMessage(chatId, `✅ Готово, ${user.fullName}! Тепер ви отримуватимете сповіщення про нові подання, що очікують підтвердження.`);
    }
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
        telegramPendingPercents: null,
        telegramAwaitingPercentsInput: false,
        telegramAwaitingPhotoForExecutionId: null,
      },
    });
    await this.telegram.sendMessage(chatId, "Відв'язано. Щоб користуватись ботом знову, попросіть у HR новий код: /start КОД");
  }

  private async findByChatId(chatId: string) {
    return this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
  }

  /**
   * Resolves a chat id to the admin identity — a paired User (not Employee)
   * who currently holds `production-executions:record` and/or
   * `production-executions:confirm`. Both re-checked live on every call
   * (same "never cache a permission across time" rule applied elsewhere in
   * this bot): a role change changes what this chat can do immediately, no
   * re-pairing needed. `canRecord` gates "Подати роботу за працівника" +
   * "Сьогодні записано мною"; `canConfirm` gates "На підтвердження" (2026-
   * 10-05 — previously a confirm-only User got no active bot menu at all,
   * just passive push notifications; see buildAdminMenu). Returns null for
   * a User with no membership, or one who holds neither permission (see
   * the "plainUser" fallback in handleMessage/sendWelcome).
   */
  private async findAdminByChatId(chatId: string): Promise<PairedAdminUser | null> {
    const user = await this.pairingPrisma.user.findFirst({ where: { telegramChatId: chatId } });
    if (!user) return null;
    const membership = await this.pairingPrisma.companyMembership.findFirst({ where: { userId: user.id } });
    if (!membership) return null;
    const [canRecord, canConfirm] = await this.prisma.runInTenantTransaction({ companyId: membership.companyId, userId: user.id }, (tx) =>
      Promise.all([this.userHasPermission(tx, user.id, RECORD_PERMISSION_KEY), this.userHasPermission(tx, user.id, CONFIRM_PERMISSION_KEY)]),
    );
    if (!canRecord && !canConfirm) return null;
    return {
      id: user.id,
      companyId: membership.companyId,
      fullName: user.fullName,
      email: user.email,
      telegramChatId: chatId,
      canRecord,
      canConfirm,
      telegramAdminPendingEmployeeIds: user.telegramAdminPendingEmployeeIds,
      telegramAdminPendingProductionOrderId: user.telegramAdminPendingProductionOrderId,
      telegramAdminPendingWorkTaskId: user.telegramAdminPendingWorkTaskId,
      telegramAdminPendingQty: user.telegramAdminPendingQty,
      telegramAdminPendingPercents: user.telegramAdminPendingPercents,
      telegramAdminAwaitingPercentsInput: Boolean(user.telegramAdminAwaitingPercentsInput),
      telegramAdminAwaitingPhotoForExecutionId: user.telegramAdminAwaitingPhotoForExecutionId,
      telegramAdminAwaitingSummaryQuery: Boolean(user.telegramAdminAwaitingSummaryQuery),
    };
  }

  private async clearAdminPending(userId: string): Promise<void> {
    await this.pairingPrisma.user.update({
      where: { id: userId },
      data: {
        telegramAdminPendingEmployeeIds: null,
        telegramAdminPendingProductionOrderId: null,
        telegramAdminPendingWorkTaskId: null,
        telegramAdminPendingQty: null,
        telegramAdminPendingPercents: null,
        telegramAdminAwaitingPercentsInput: false,
        telegramAdminAwaitingSummaryQuery: false,
      },
    });
  }

  // ============================================================
  // Admin flow — "Подати роботу за іншого працівника" (2026-10-05)
  //
  // Structurally parallel to the Employee self-submit flow above, but
  // deliberately NOT sharing its methods: the acting identity here is a
  // User (PairedAdminUser, FSM state on User.telegramAdminPending*), and
  // there is no "who performed it" step — the admin already picked WHO
  // first, before WHAT. Some duplication with sendOrderListPage/
  // handleSearch/sendWorkTaskListPage below is a disclosed, deliberate
  // tradeoff: keeping the Employee flow's methods untouched (and its
  // existing test coverage valid) mattered more than deduplicating ~80
  // lines of near-identical list/search plumbing.
  // ============================================================

  private async handleAdminMessage(admin: PairedAdminUser, text: string): Promise<void> {
    const chatId = admin.telegramChatId;

    // State E — "📈 Підсумок по працівнику" asked for a name; this text IS that query.
    if (admin.telegramAdminAwaitingSummaryQuery) {
      await this.handleAdminSummaryQuery(admin, text);
      return;
    }

    // "✏️ Відсотки" asked for a number list; this text IS that list.
    if (admin.telegramAdminAwaitingPercentsInput) {
      await this.handleAdminPercentsMessage(admin, text);
      return;
    }

    // State D — review card on screen; a freshly typed number updates it in place.
    if (admin.telegramAdminPendingQty !== null) {
      const parsed = parseNumber(text);
      if (parsed !== null) {
        await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminPendingQty: String(parsed) } });
        await this.sendAdminConfirmationCard({ ...admin, telegramAdminPendingQty: String(parsed) });
      } else {
        await this.telegram.sendMessage(chatId, 'Скористайтесь кнопками вище ⬆️, або надішліть нове число чи /cancel.');
      }
      return;
    }

    // State C — a parent (order or work task) is picked, waiting for a number.
    if (admin.telegramAdminPendingProductionOrderId || admin.telegramAdminPendingWorkTaskId) {
      await this.handleAdminValueMessage(admin, text);
      return;
    }

    // State B — employee(s) picked, waiting for a parent pick (inline
    // buttons sent by sendAdminParentMenu) or free-text search.
    const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
    if (employeeIds.length > 0) {
      await this.handleAdminSearch(admin, text);
      return;
    }

    // State A — idle.
    if (admin.canRecord && (text === '👤 Подати роботу за працівника' || text === '/for')) {
      await this.sendAdminEmployeePicker(admin);
      return;
    }
    if (admin.canConfirm && (text === '📥 На підтвердження' || text === '/queue')) {
      await this.sendAdminConfirmQueue(admin, 0);
      return;
    }
    if (admin.canRecord && (text === '📊 Сьогодні записано мною' || text === '/today')) {
      await this.sendAdminTodaySubmissions(admin);
      return;
    }
    if (text === '📈 Підсумок по працівнику' || text === '/summary') {
      await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingSummaryQuery: true } });
      await this.telegram.sendMessage(chatId, '👤 Напишіть ім\'я працівника (або частину).');
      return;
    }
    if (text === '🔍 Перевірити готовність' || text === '/check') {
      await this.sendAdminReadinessOrderListPage(admin, 0);
      return;
    }
    if (text === '❓ Допомога' || text === '/help' || text.toLowerCase() === 'допомога') {
      await this.telegram.sendMessage(chatId, buildAdminHelpText(admin), buildAdminMenu(admin));
      return;
    }
    await this.telegram.sendMessage(chatId, 'Скористайтесь кнопками нижче, щоб почати.', buildAdminMenu(admin));
  }

  /** "📈 Підсумок по працівнику" step 1 — free-text name search, same matching convention as handleAdminSearch's assembly search. */
  private async handleAdminSummaryQuery(admin: PairedAdminUser, query: string): Promise<void> {
    await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingSummaryQuery: false } });
    if (!query) {
      await this.telegram.sendMessage(admin.telegramChatId, '🔍 Напишіть частину імені працівника.');
      return;
    }
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const employees: Array<{ id: string; fullName: string }> = await tx.employee.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, fullName: true },
      });
      const q = query.toLowerCase();
      const matches = employees.filter((e) => e.fullName.toLowerCase().includes(q)).slice(0, 8);
      if (matches.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '🤷 Нічого не знайдено. Спробуйте інше ім\'я.', buildAdminMenu(admin));
        return;
      }
      await this.telegram.sendMessage(admin.telegramChatId, '👤 Оберіть працівника:', {
        inline_keyboard: matches.map((e) => [{ text: e.fullName, callback_data: `admin:summary:emp:${e.id}` }]),
      });
    });
  }

  private async sendAdminSummaryPeriodPicker(chatId: string, employeeId: string): Promise<void> {
    await this.telegram.sendMessage(chatId, '📅 За який період?', {
      inline_keyboard: [
        [
          { text: 'Сьогодні', callback_data: `admin:summary:period:${employeeId}:today` },
          { text: '7 днів', callback_data: `admin:summary:period:${employeeId}:week` },
        ],
        [
          { text: 'Цей місяць', callback_data: `admin:summary:period:${employeeId}:month` },
          { text: 'Увесь час', callback_data: `admin:summary:period:${employeeId}:all` },
        ],
      ],
    });
  }

  /** "📈 Підсумок по працівнику" step 3 — PayrollEntry is the real, already-paid-out ledger (same source getPayrollFundSummary's own "earnedActual" reads), grouped by the assembly/work-task each entry's execution belongs to. Unlike that report, this is scoped to ONE employee and ONE ad-hoc period, not a whole order. */
  private async sendAdminEmployeeSummary(admin: PairedAdminUser, employeeId: string, period: SummaryPeriod): Promise<void> {
    const { start, end, label } = summaryPeriodRange(period);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const employeeRow = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employeeRow) {
        await this.telegram.sendMessage(admin.telegramChatId, 'Працівника не знайдено.', buildAdminMenu(admin));
        return;
      }

      const entries: Array<{ productionOrderId: string | null; amount: unknown; unitsProduced: unknown; sourceAllocation: { execution: { workTaskId: string | null } | null } | null }> =
        await tx.payrollEntry.findMany({
          where: { employeeId, type: 'PIECEWORK', entryDate: { gte: start, lt: end } },
          include: { sourceAllocation: { include: { execution: { select: { workTaskId: true } } } } },
        });

      if (entries.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, `📭 <b>${escapeHtml(employeeRow.fullName)}</b>: немає підтверджених записів за ${label}.`, buildAdminMenu(admin));
        return;
      }

      const totalEarned = entries.reduce((sum, e) => sum + Number(e.amount), 0);
      const totalUnits = entries.reduce((sum, e) => sum + Number(e.unitsProduced ?? 0), 0);

      const productionOrderIds = Array.from(new Set(entries.map((e) => e.productionOrderId).filter((id): id is string => Boolean(id))));
      const orders: Array<{ id: string; assemblyId: string }> = productionOrderIds.length
        ? await tx.productionOrder.findMany({ where: { id: { in: productionOrderIds } } })
        : [];
      const assemblyIdByOrderId = new Map(orders.map((o) => [o.id, o.assemblyId]));
      const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
      const assemblies: Array<{ id: string; article: string | null; name: string }> = assemblyIds.length
        ? await tx.assembly.findMany({ where: { id: { in: assemblyIds } } })
        : [];
      const assemblyById = new Map(assemblies.map((a) => [a.id, a]));

      const workTaskIds = Array.from(new Set(entries.map((e) => e.sourceAllocation?.execution?.workTaskId).filter((id): id is string => Boolean(id))));
      const workTasks: Array<{ id: string; title: string }> = workTaskIds.length ? await tx.workTask.findMany({ where: { id: { in: workTaskIds } } }) : [];
      const workTaskById = new Map(workTasks.map((w) => [w.id, w]));

      const byLabel = new Map<string, number>();
      for (const e of entries) {
        let rowLabel: string;
        if (e.productionOrderId) {
          const assemblyId = assemblyIdByOrderId.get(e.productionOrderId);
          rowLabel = describeAssembly(assemblyId ? assemblyById.get(assemblyId) : undefined);
        } else {
          const workTaskId = e.sourceAllocation?.execution?.workTaskId ?? undefined;
          rowLabel = (workTaskId ? workTaskById.get(workTaskId)?.title : undefined) ?? 'Загальна робота';
        }
        byLabel.set(rowLabel, (byLabel.get(rowLabel) ?? 0) + Number(e.amount));
      }
      const breakdownLines = Array.from(byLabel.entries())
        .map(([rowLabel, amount]) => `  • ${escapeHtml(rowLabel)}: ${amount.toFixed(2)} €`)
        .join('\n');

      await this.telegram.sendMessage(
        admin.telegramChatId,
        `📈 <b>${escapeHtml(employeeRow.fullName)}</b> — ${label}\n\n💶 Заробіток: <b>${totalEarned.toFixed(2)} €</b>\n🔢 Одиниць (де застосовно): ${totalUnits}\n\n${breakdownLines}`,
        buildAdminMenu(admin),
      );
    });
  }

  // ============================================================
  // "📥 На підтвердження" — the admin confirm/reject queue (2026-10-05):
  // same approve:/reject: callback_data (and the SAME handleSupervisorDecision)
  // notifySupervisors' own push notification already uses — this is just an
  // on-demand listing of every current DRAFT instead of waiting for a push.
  // ============================================================

  private async sendAdminConfirmQueue(admin: PairedAdminUser, page: number): Promise<void> {
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const executions: Array<{
        id: string;
        productionOrderId: string | null;
        workTaskId: string | null;
        qtyCompleted: unknown;
        totalAmount: unknown;
        allocations: Array<{ employeeId: string }>;
      }> = await tx.productionExecution.findMany({ where: { status: 'DRAFT' }, orderBy: { performedAt: 'asc' }, include: { allocations: true } });

      if (executions.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '✅ Немає подань, що очікують підтвердження.', buildAdminMenu(admin));
        return;
      }

      const totalPages = Math.ceil(executions.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = executions.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      for (const execution of shown) {
        const description = await this.describeExecutionParent(tx, execution);
        const employeeIds = execution.allocations.map((a) => a.employeeId);
        const employees: Array<{ fullName: string }> = employeeIds.length ? await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { fullName: true } }) : [];
        const names = employees.map((e) => escapeHtml(e.fullName)).join(', ') || '—';
        const value = execution.productionOrderId ? `${execution.qtyCompleted ?? '—'} шт` : `${Number(execution.totalAmount)} €`;
        await this.telegram.sendMessage(admin.telegramChatId, `🔔 ${description}\n👤 ${names}\n🔢 ${value}`, {
          inline_keyboard: [[
            { text: '✅ Підтвердити', callback_data: `approve:${admin.companyId}:${execution.id}` },
            { text: '❌ Відхилити', callback_data: `reject:${admin.companyId}:${execution.id}` },
          ]],
        });
      }

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `admin:queue:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `admin:queue:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  // ============================================================
  // "📊 Сьогодні записано мною" — executions THIS admin recorded for
  // others today, matched via ProductionExecution.recordedById (set by
  // ProductionExecutionsService#create from whatever `syntheticUser` a
  // caller passes — submitPendingAdminExecution passes the admin's own id,
  // so this is a plain, reliable field match, no fragile note-text parsing.
  // ============================================================

  private async sendAdminTodaySubmissions(admin: PairedAdminUser): Promise<void> {
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const { startOfDay, endOfDay } = todayRange();
      const executions: Array<{
        id: string;
        productionOrderId: string | null;
        workTaskId: string | null;
        qtyCompleted: unknown;
        totalAmount: unknown;
        status: string;
        allocations: Array<{ employeeId: string }>;
      }> = await tx.productionExecution.findMany({
        where: { recordedById: admin.id, performedAt: { gte: startOfDay, lt: endOfDay } },
        include: { allocations: true },
        orderBy: { createdAt: 'desc' },
      });

      if (executions.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '📭 Сьогодні ви ще нічого не записали за інших працівників.', buildAdminMenu(admin));
        return;
      }

      const lines: string[] = [];
      for (const e of executions) {
        const description = await this.describeExecutionParent(tx, e);
        const employeeIds = e.allocations.map((a) => a.employeeId);
        const employees: Array<{ fullName: string }> = employeeIds.length ? await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { fullName: true } }) : [];
        const names = employees.map((emp) => escapeHtml(emp.fullName)).join(', ');
        const icon = e.status === 'DRAFT' ? '⏳' : e.status === 'CONFIRMED' ? '✅' : '↩️';
        const label = e.status === 'DRAFT' ? 'очікує підтвердження' : e.status === 'CONFIRMED' ? 'підтверджено' : 'скасовано';
        const value = e.productionOrderId ? `${e.qtyCompleted ?? '—'} шт` : `${Number(e.totalAmount)} €`;
        lines.push(`${icon} ${description}, ${value} — ${names} (${label})`);
      }
      await this.telegram.sendMessage(admin.telegramChatId, `📊 <b>Записано вами сьогодні:</b>\n\n${lines.join('\n')}`, buildAdminMenu(admin));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is PrismaService's extended, request-scoped transactional client; see loadAssembliesFor's own identical comment.
  private async describeExecutionParent(tx: any, execution: { productionOrderId: string | null; workTaskId: string | null }): Promise<string> {
    if (execution.productionOrderId) {
      const order = await tx.productionOrder.findUnique({ where: { id: execution.productionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;
      return `📦 ${escapeHtml(describeAssembly(assembly))}`;
    }
    const workTask = await tx.workTask.findUnique({ where: { id: execution.workTaskId! } });
    return `🛠 ${escapeHtml(workTask?.title ?? 'Загальна робота')}`;
  }

  private async sendAdminEmployeePicker(admin: PairedAdminUser, messageId?: number): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const employees: Array<{ id: string; fullName: string }> = await tx.employee.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { fullName: 'asc' },
        take: COLLEAGUE_PICKER_LIMIT,
        select: { id: true, fullName: true },
      });
      if (employees.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, 'Активних співробітників не знайдено.', buildAdminMenu(admin));
        return;
      }
      const selected = parseAllocations(admin.telegramAdminPendingEmployeeIds);
      const text = '👤 За кого подати роботу? Оберіть одного чи кількох (торкніться), потім «✅ Готово»:';
      const keyboard = buildToggleKeyboard(employees, selected, 'admin:emp:toggle:', 'admin:emp:done', 'admin:emp:cancel');
      if (messageId) {
        await this.telegram.editMessageText(admin.telegramChatId, messageId, text, keyboard);
      } else {
        await this.telegram.sendMessage(admin.telegramChatId, text, keyboard);
      }
    });
  }

  private async toggleAdminEmployee(admin: PairedAdminUser, employeeId: string, messageId: number): Promise<void> {
    const selected = new Set(parseAllocations(admin.telegramAdminPendingEmployeeIds));
    if (selected.has(employeeId)) selected.delete(employeeId);
    else selected.add(employeeId);
    const updated = await this.pairingPrisma.user.update({
      where: { id: admin.id },
      data: { telegramAdminPendingEmployeeIds: JSON.stringify([...selected]) },
    });
    await this.sendAdminEmployeePicker({ ...admin, telegramAdminPendingEmployeeIds: updated.telegramAdminPendingEmployeeIds }, messageId);
  }

  private async sendAdminParentMenu(admin: PairedAdminUser): Promise<void> {
    const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const employees: Array<{ fullName: string }> = await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { fullName: true } });
      const names = employees.map((e) => escapeHtml(e.fullName)).join(', ');
      await this.telegram.sendMessage(admin.telegramChatId, `👥 Обрано: <b>${names}</b>.\n\nЩо вони виконали?`, {
        inline_keyboard: [[{ text: '📦 Виріб (замовлення)', callback_data: 'admin:menu:orders' }, { text: '🛠 Загальна робота', callback_data: 'admin:menu:tasks' }]],
      });
    });
  }

  // ============================================================
  // "🔍 Перевірити готовність" (2026-10-06 user request, the exact
  // question asked in chat about order #440172/409219.L): lists PLANNED
  // batches (readiness is only meaningful before a batch starts — an
  // IN_PROGRESS one already passed this check) and runs
  // ProductionOrdersService#checkReadiness — the SAME shortage math
  // start() itself uses, factored out read-only so nothing here duplicates
  // the physical-stock-minus-other-orders'-reservations logic.
  // ============================================================

  private async sendAdminReadinessOrderListPage(admin: PairedAdminUser, page: number): Promise<void> {
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'PLANNED' }, orderBy: { createdAt: 'desc' } });
      if (orders.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '✅ Немає запланованих партій, що очікують запуску.', buildAdminMenu(admin));
        return;
      }
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const totalPages = Math.ceil(orders.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = orders.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      for (const o of shown) {
        const a = assemblyById.get(o.assemblyId);
        await this.telegram.sendMessage(admin.telegramChatId, `📦 ${escapeHtml(describeAssembly(a))} (${Number(o.unitsPlanned)} шт)`, {
          inline_keyboard: [[{ text: '🔍 Перевірити', callback_data: `admin:check:${o.id}` }]],
        });
      }

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `admin:checkpage:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `admin:checkpage:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  private async sendAdminReadinessResult(admin: PairedAdminUser, productionOrderId: string): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const syntheticUser: RequestUser = { userId: admin.id, companyId: admin.companyId, email: admin.email, roleId: '' };
      const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;
      const description = `📦 ${escapeHtml(describeAssembly(assembly))}`;

      try {
        const result = await this.productionOrdersService.checkReadiness(syntheticUser, productionOrderId);
        if (result.ready) {
          await this.telegram.sendMessage(admin.telegramChatId, `✅ ${description}\n\nГотове до запуску — всіх компонентів і підвиробів вистачає.`, buildAdminMenu(admin));
          return;
        }
        const lines = await this.describeShortageLines(tx, result.shortages);
        await this.telegram.sendMessage(admin.telegramChatId, `⚠️ ${description}\n\nНЕ готове до запуску. Не вистачає:\n${lines.join('\n')}`, buildAdminMenu(admin));
      } catch (err) {
        await this.telegram.sendMessage(admin.telegramChatId, `⚠️ ${escapeHtml(extractErrorMessage(err))}`, buildAdminMenu(admin));
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is PrismaService's extended, request-scoped transactional client; see loadAssembliesFor's own identical comment.
  private async describeShortageLines(
    tx: any,
    shortages: Array<{ kind: 'PRODUCT' | 'ASSEMBLY'; productId?: string; subAssemblyId?: string; needed: number; available: number }>,
  ): Promise<string[]> {
    const productIds = shortages.filter((s) => s.kind === 'PRODUCT').map((s) => s.productId!);
    const subAssemblyIds = shortages.filter((s) => s.kind === 'ASSEMBLY').map((s) => s.subAssemblyId!);
    const products: Array<{ id: string; article: string; name: string }> = productIds.length ? await tx.product.findMany({ where: { id: { in: productIds } } }) : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const subAssemblies: Array<{ id: string; article: string | null; name: string }> = subAssemblyIds.length
      ? await tx.assembly.findMany({ where: { id: { in: subAssemblyIds } } })
      : [];
    const subAssemblyById = new Map(subAssemblies.map((a) => [a.id, a]));

    return shortages.map((s) => {
      if (s.kind === 'PRODUCT') {
        const p = productById.get(s.productId!);
        const label = p ? `${p.article} — ${p.name}` : s.productId!;
        return `  • ${escapeHtml(label)}: потрібно ${s.needed}, є ${s.available} (не вистачає ${s.needed - s.available})`;
      }
      const label = describeAssembly(subAssemblyById.get(s.subAssemblyId!));
      const needed = Math.ceil(s.needed);
      return `  • ${escapeHtml(label)}: потрібно ${needed}, є ${s.available} (не вистачає ${needed - s.available})`;
    });
  }

  private async sendAdminOrderListPage(admin: PairedAdminUser, page: number): Promise<void> {
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' } });
      if (orders.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '😴 Немає активних замовлень у виробництві зараз.', buildAdminMenu(admin));
        return;
      }
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const totalPages = Math.ceil(orders.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = orders.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      await this.sendAdminOrderResults(admin, shown, assemblyById);

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `admin:list:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `admin:list:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}. Або напишіть частину артикулу/назви для пошуку.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  private async sendAdminOrderResults(
    admin: PairedAdminUser,
    orders: Array<{ id: string; assemblyId: string; unitsPlanned: unknown }>,
    assemblyById: Map<string, { article: string | null; name: string }>,
  ): Promise<void> {
    if (orders.length === 0) return;
    const syntheticUser: RequestUser = { userId: admin.id, companyId: admin.companyId, email: admin.email, roleId: '' };
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
      const button = { inline_keyboard: [[{ text: '✅ Обрати', callback_data: `admin:order:${o.id}` }]] };
      const photoUrl = photosByAssembly[o.assemblyId]?.[0]?.downloadUrl;
      const sentPhoto = photoUrl ? await this.telegram.sendPhoto(admin.telegramChatId, photoUrl, caption, button) : false;
      if (!sentPhoto) {
        await this.telegram.sendMessage(admin.telegramChatId, caption, button);
      }
    }
  }

  private async handleAdminSearch(admin: PairedAdminUser, query: string): Promise<void> {
    if (!query) {
      await this.telegram.sendMessage(admin.telegramChatId, '🔍 Напишіть частину артикулу або назви виробу, або оберіть вище.');
      return;
    }
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, take: 200 });
      const assemblyById = await this.loadAssembliesFor(tx, orders);

      const q = query.toLowerCase();
      const matches = orders.filter((o) => {
        const a = assemblyById.get(o.assemblyId);
        if (!a) return false;
        return a.name.toLowerCase().includes(q) || (a.article?.toLowerCase().includes(q) ?? false);
      });

      if (matches.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '🤷 Нічого не знайдено серед активних замовлень. Спробуйте інший текст.');
        return;
      }
      const shown = matches.slice(0, MAX_ORDER_RESULTS);
      const note = matches.length > shown.length ? ` (показано ${shown.length} з ${matches.length} — уточніть пошук, якщо не бачите потрібне)` : '';
      await this.telegram.sendMessage(admin.telegramChatId, `🔍 Оберіть виріб${note}:`);
      await this.sendAdminOrderResults(admin, shown, assemblyById);
    });
  }

  private async sendAdminWorkTaskListPage(admin: PairedAdminUser, page: number): Promise<void> {
    await this.telegram.sendChatAction(admin.telegramChatId);
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const tasks = await tx.workTask.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
      if (tasks.length === 0) {
        await this.telegram.sendMessage(admin.telegramChatId, '😴 Немає відкритих загальних робіт зараз.', buildAdminMenu(admin));
        return;
      }
      const totalPages = Math.ceil(tasks.length / LIST_PAGE_SIZE);
      const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const shown = tasks.slice(clampedPage * LIST_PAGE_SIZE, clampedPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

      for (const t of shown) {
        await this.telegram.sendMessage(admin.telegramChatId, `🛠 ${escapeHtml(t.title)}`, {
          inline_keyboard: [[{ text: '✅ Обрати', callback_data: `admin:worktask:${t.id}` }]],
        });
      }

      const navButtons = [];
      if (clampedPage > 0) navButtons.push({ text: '⬅️ Попередня', callback_data: `admin:wtlist:${clampedPage - 1}` });
      if (clampedPage < totalPages - 1) navButtons.push({ text: 'Наступна ➡️', callback_data: `admin:wtlist:${clampedPage + 1}` });
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `📄 Сторінка ${clampedPage + 1} з ${totalPages}.`,
        navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined,
      );
    });
  }

  private async handleAdminValueMessage(admin: PairedAdminUser, text: string): Promise<void> {
    const value = parseNumber(text);
    if (value === null) {
      const label = admin.telegramAdminPendingWorkTaskId ? 'суму' : 'кількість';
      await this.telegram.sendMessage(admin.telegramChatId, `🔢 Введіть додатне число (${label}), або /cancel для скасування.`);
      return;
    }
    await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminPendingQty: String(value) } });
    await this.sendAdminConfirmationCard({ ...admin, telegramAdminPendingQty: String(value) });
  }

  private async sendAdminConfirmationCard(admin: PairedAdminUser & { telegramAdminPendingQty: string }): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const description = await this.describeAdminPendingParent(tx, admin);
      const valueLabel = admin.telegramAdminPendingWorkTaskId ? 'Сума' : 'Кількість';
      const valueSuffix = admin.telegramAdminPendingWorkTaskId ? ' €' : '';

      const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
      const employees: Array<{ id: string; fullName: string }> = await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, fullName: true } });
      const employeeById = new Map(employees.map((e) => [e.id, e.fullName]));
      const participants = employeeIds.map((id) => ({ id, label: employeeById.get(id) ?? '…' }));
      const namesLine = formatPercentsLine(participants, parsePercentMap(admin.telegramAdminPendingPercents)) || `\n👥 За: ${participants.map((p) => escapeHtml(p.label)).join(', ')}`;

      const buttons: TelegramInlineKeyboard =
        participants.length > 1
          ? {
              inline_keyboard: [
                [{ text: '✅ Підтвердити', callback_data: 'admin:submit:confirm' }],
                [{ text: '✏️ Кількість', callback_data: 'admin:submit:editqty' }, { text: '✏️ Відсотки', callback_data: 'admin:submit:editpercents' }],
                [{ text: '❌ Скасувати', callback_data: 'admin:submit:cancel' }],
              ],
            }
          : {
              inline_keyboard: [
                [{ text: '✅ Підтвердити', callback_data: 'admin:submit:confirm' }],
                [{ text: '✏️ Змінити', callback_data: 'admin:submit:editqty' }, { text: '❌ Скасувати', callback_data: 'admin:submit:cancel' }],
              ],
            };
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `👀 <b>Перевірте перед підтвердженням</b>\n\n${description}${namesLine}\n${valueLabel}: <b>${admin.telegramAdminPendingQty}${valueSuffix}</b>\n\nВсе вірно?`,
        buttons,
      );
    });
  }

  /** Admin counterpart to promptForPercents — see that method's own doc comment. */
  private async promptForAdminPercents(admin: PairedAdminUser): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
      const employees: Array<{ id: string; fullName: string }> = await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, fullName: true } });
      const employeeById = new Map(employees.map((e) => [e.id, e.fullName]));
      const labels = employeeIds.map((id) => employeeById.get(id) ?? '…');
      await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingPercentsInput: true } });
      await this.telegram.sendMessage(
        admin.telegramChatId,
        `🔢 Введіть відсотки через пробіл чи кому, у тому ж порядку: <b>${escapeHtml(labels.join(', '))}</b>\n(наприклад: 60 40)`,
      );
    });
  }

  private async handleAdminPercentsMessage(admin: PairedAdminUser, text: string): Promise<void> {
    const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
    const parsed = parsePercentList(text, employeeIds.length);
    if (!parsed) {
      await this.telegram.sendMessage(admin.telegramChatId, `⚠️ Потрібно рівно ${employeeIds.length} додатних чисел, через пробіл чи кому. Спробуйте ще раз або /cancel.`);
      return;
    }
    const percents = Object.fromEntries(employeeIds.map((id, i) => [id, parsed[i]]));
    await this.pairingPrisma.user.update({
      where: { id: admin.id },
      data: { telegramAdminPendingPercents: JSON.stringify(percents), telegramAdminAwaitingPercentsInput: false },
    });
    await this.sendAdminConfirmationCard({ ...admin, telegramAdminPendingQty: admin.telegramAdminPendingQty!, telegramAdminPendingPercents: JSON.stringify(percents) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is PrismaService's extended, request-scoped transactional client; see loadAssembliesFor's own identical comment.
  private async describeAdminPendingParent(tx: any, admin: PairedAdminUser): Promise<string> {
    if (admin.telegramAdminPendingProductionOrderId) {
      const order = await tx.productionOrder.findUnique({ where: { id: admin.telegramAdminPendingProductionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;
      return `📦 ${escapeHtml(describeAssembly(assembly))}`;
    }
    const workTask = await tx.workTask.findUnique({ where: { id: admin.telegramAdminPendingWorkTaskId! } });
    return `🛠 ${escapeHtml(workTask?.title ?? 'Загальна робота')}`;
  }

  private async submitPendingAdminExecution(admin: PairedAdminUser): Promise<void> {
    const value = admin.telegramAdminPendingQty !== null ? Number(admin.telegramAdminPendingQty) : null;
    const productionOrderId = admin.telegramAdminPendingProductionOrderId;
    const workTaskId = admin.telegramAdminPendingWorkTaskId;
    const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
    if (value === null || (!productionOrderId && !workTaskId) || employeeIds.length === 0) {
      await this.telegram.sendMessage(admin.telegramChatId, 'Нічого очікує підтвердження — оберіть ще раз.', buildAdminMenu(admin));
      return;
    }
    const equalShare = round2(100 / employeeIds.length);
    const customPercents = parsePercentMap(admin.telegramAdminPendingPercents);

    await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
      const description = await this.describeAdminPendingParent(tx, admin);
      const syntheticUser: RequestUser = { userId: admin.id, companyId: admin.companyId, email: admin.email, roleId: '' };
      const dto: CreateProductionExecutionDto = {
        productionOrderId: productionOrderId ?? undefined,
        workTaskId: workTaskId ?? undefined,
        performedAt: new Date(),
        qtyCompleted: productionOrderId ? value : undefined,
        totalAmount: workTaskId ? value : undefined,
        method: employeeIds.length > 1 ? 'MULTI_WORKER' : 'SOLO',
        allocationMode: 'PERCENT',
        allocations: employeeIds.map((employeeId) => ({ employeeId, percent: customPercents?.[employeeId] ?? equalShare })),
        note: `Подано через Telegram (адміністратором ${admin.fullName})`,
      };

      try {
        const execution = await this.productionExecutionsService.create(syntheticUser, dto);
        await tx.productionExecution.update({ where: { id: execution.id }, data: { submittedViaTelegram: true } });
        await this.clearAdminPending(admin.id);
        await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingPhotoForExecutionId: execution.id } });

        await this.telegram.sendMessage(
          admin.telegramChatId,
          `✅ Подано на підтвердження!\n${description}\n\nЗаписано за: ${employeeIds.length} працівник(ів).`,
          buildAdminMenu(admin),
        );
        await this.telegram.sendMessage(admin.telegramChatId, '📷 Бажаєте додати фото підтвердження?', {
          inline_keyboard: [[{ text: 'Пропустити', callback_data: 'admin:photo:skip' }]],
        });

        await this.notifySupervisors(tx, admin, execution.id, description, value, productionOrderId ? 'шт' : '€');
        for (const employeeId of employeeIds) {
          const employeeRow = await tx.employee.findUnique({ where: { id: employeeId } });
          if (employeeRow?.telegramChatId) {
            await this.telegram.sendMessage(
              employeeRow.telegramChatId,
              `ℹ️ ${escapeHtml(admin.fullName)} записав(-ла) за вас виконану роботу:\n${description}`,
            );
          }
        }
      } catch (err) {
        await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminPendingQty: null } });
        await this.telegram.sendMessage(admin.telegramChatId, `⚠️ ${escapeHtml(extractErrorMessage(err))}\n🔢 Введіть інше число або /cancel.`);
      }
    });
  }

  private async handleAdminCallback(callbackId: string, chatId: string, data: string, messageId: number | undefined): Promise<void> {
    const admin = await this.findAdminByChatId(chatId);
    if (!admin) {
      await this.telegram.answerCallbackQuery(callbackId, "Недостатньо прав, або ви не прив'язані.");
      return;
    }

    if (data.startsWith('admin:emp:toggle:') && messageId) {
      const employeeId = data.slice('admin:emp:toggle:'.length);
      await this.toggleAdminEmployee(admin, employeeId, messageId);
      await this.telegram.answerCallbackQuery(callbackId);
      return;
    }
    if (data === 'admin:emp:done') {
      const employeeIds = parseAllocations(admin.telegramAdminPendingEmployeeIds);
      if (employeeIds.length === 0) {
        await this.telegram.answerCallbackQuery(callbackId, 'Оберіть хоча б одного працівника.');
        return;
      }
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminParentMenu(admin);
      return;
    }
    if (data === 'admin:emp:cancel') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.clearAdminPending(admin.id);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', buildAdminMenu(admin));
      return;
    }
    if (data === 'admin:menu:orders') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminOrderListPage(admin, 0);
      return;
    }
    if (data === 'admin:menu:tasks') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminWorkTaskListPage(admin, 0);
      return;
    }
    if (data.startsWith('admin:list:')) {
      await this.telegram.answerCallbackQuery(callbackId);
      const page = Number(data.slice('admin:list:'.length));
      await this.sendAdminOrderListPage(admin, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }
    if (data.startsWith('admin:wtlist:')) {
      await this.telegram.answerCallbackQuery(callbackId);
      const page = Number(data.slice('admin:wtlist:'.length));
      await this.sendAdminWorkTaskListPage(admin, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }
    if (data.startsWith('admin:queue:')) {
      await this.telegram.answerCallbackQuery(callbackId);
      const page = Number(data.slice('admin:queue:'.length));
      await this.sendAdminConfirmQueue(admin, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }
    if (data.startsWith('admin:summary:emp:')) {
      const employeeId = data.slice('admin:summary:emp:'.length);
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminSummaryPeriodPicker(chatId, employeeId);
      return;
    }
    if (data.startsWith('admin:summary:period:')) {
      const rest = data.slice('admin:summary:period:'.length); // "<employeeId>:<period>" — employeeId is a UUID (no colons), so the LAST colon always separates the period suffix.
      const lastColon = rest.lastIndexOf(':');
      const employeeId = rest.slice(0, lastColon);
      const period = rest.slice(lastColon + 1) as SummaryPeriod;
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminEmployeeSummary(admin, employeeId, period);
      return;
    }
    if (data.startsWith('admin:checkpage:')) {
      await this.telegram.answerCallbackQuery(callbackId);
      const page = Number(data.slice('admin:checkpage:'.length));
      await this.sendAdminReadinessOrderListPage(admin, Number.isFinite(page) && page >= 0 ? page : 0);
      return;
    }
    if (data.startsWith('admin:check:')) {
      const productionOrderId = data.slice('admin:check:'.length);
      await this.telegram.answerCallbackQuery(callbackId);
      await this.sendAdminReadinessResult(admin, productionOrderId);
      return;
    }
    if (data.startsWith('admin:order:')) {
      const productionOrderId = data.slice('admin:order:'.length);
      await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
        const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
        if (!order || order.status !== 'IN_PROGRESS') {
          await this.telegram.answerCallbackQuery(callbackId, 'Це замовлення більше не доступне.');
          return;
        }
        const assembly = await tx.assembly.findUnique({ where: { id: order.assemblyId } });
        await this.pairingPrisma.user.update({
          where: { id: admin.id },
          data: { telegramAdminPendingProductionOrderId: order.id, telegramAdminPendingWorkTaskId: null, telegramAdminPendingQty: null },
        });
        await this.telegram.answerCallbackQuery(callbackId);
        await this.telegram.sendMessage(chatId, `📦 Обрано: <b>${escapeHtml(describeAssembly(assembly))}</b>\n🔢 Введіть кількість (число).`);
      });
      return;
    }
    if (data.startsWith('admin:worktask:')) {
      const workTaskId = data.slice('admin:worktask:'.length);
      await this.prisma.runInTenantTransaction({ companyId: admin.companyId, userId: admin.id }, async (tx) => {
        const workTask = await tx.workTask.findUnique({ where: { id: workTaskId } });
        if (!workTask || workTask.status !== 'OPEN') {
          await this.telegram.answerCallbackQuery(callbackId, 'Ця робота більше не доступна.');
          return;
        }
        await this.pairingPrisma.user.update({
          where: { id: admin.id },
          data: { telegramAdminPendingWorkTaskId: workTask.id, telegramAdminPendingProductionOrderId: null, telegramAdminPendingQty: null },
        });
        await this.telegram.answerCallbackQuery(callbackId);
        await this.telegram.sendMessage(chatId, `🛠 Обрано: <b>${escapeHtml(workTask.title)}</b>\n💶 Введіть суму, € (число).`);
      });
      return;
    }
    if (data === 'admin:submit:confirm') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.submitPendingAdminExecution(admin);
      return;
    }
    if (data === 'admin:submit:editqty') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminPendingQty: null } });
      await this.telegram.sendMessage(chatId, admin.telegramAdminPendingWorkTaskId ? '💶 Введіть суму ще раз.' : '🔢 Введіть кількість ще раз.');
      return;
    }
    if (data === 'admin:submit:editpercents') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.promptForAdminPercents(admin);
      return;
    }
    if (data === 'admin:submit:cancel') {
      await this.telegram.answerCallbackQuery(callbackId);
      await this.clearAdminPending(admin.id);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.', buildAdminMenu(admin));
      return;
    }
    if (data === 'admin:photo:skip') {
      await this.pairingPrisma.user.update({ where: { id: admin.id }, data: { telegramAdminAwaitingPhotoForExecutionId: null } });
      await this.telegram.answerCallbackQuery(callbackId);
      await this.telegram.sendMessage(chatId, '👍 Гаразд.', buildAdminMenu(admin));
      return;
    }

    await this.telegram.answerCallbackQuery(callbackId);
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
      const participants: Array<{ id: string; label: string }> = [{ id: employee.id, label: 'Ви' }];
      if (colleagueIds.length > 0) {
        const colleagues: Array<{ id: string; fullName: string }> = await tx.employee.findMany({ where: { id: { in: colleagueIds } }, select: { id: true, fullName: true } });
        const colleagueById = new Map(colleagues.map((c) => [c.id, c.fullName]));
        for (const id of colleagueIds) participants.push({ id, label: colleagueById.get(id) ?? '…' });
      }
      const participantsLine = formatPercentsLine(participants, parsePercentMap(employee.telegramPendingPercents));

      const buttons: TelegramInlineKeyboard =
        participants.length > 1
          ? {
              inline_keyboard: [
                [{ text: '✅ Підтвердити', callback_data: 'submit:confirm' }],
                [{ text: '✏️ Кількість', callback_data: 'submit:editqty' }, { text: '✏️ Відсотки', callback_data: 'submit:editpercents' }],
                [{ text: '❌ Скасувати', callback_data: 'submit:cancel' }],
              ],
            }
          : {
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

  /** "✏️ Відсотки" on the review card (2026-10-07 — "не зрозуміло за якими відсотками йде розподіл"): asks for one number per participant, in the SAME order the confirmation card just listed them. */
  private async promptForPercents(employee: PairedEmployee): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const colleagueIds = parseAllocations(employee.telegramPendingAllocations);
      const labels = ['Ви'];
      if (colleagueIds.length > 0) {
        const colleagues: Array<{ id: string; fullName: string }> = await tx.employee.findMany({ where: { id: { in: colleagueIds } }, select: { id: true, fullName: true } });
        const colleagueById = new Map(colleagues.map((c) => [c.id, c.fullName]));
        for (const id of colleagueIds) labels.push(colleagueById.get(id) ?? '…');
      }
      await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramAwaitingPercentsInput: true } });
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `🔢 Введіть відсотки через пробіл чи кому, у тому ж порядку: <b>${escapeHtml(labels.join(', '))}</b>\n(наприклад: 60 40)`,
      );
    });
  }

  private async handlePercentsMessage(employee: PairedEmployee, text: string): Promise<void> {
    const colleagueIds = parseAllocations(employee.telegramPendingAllocations);
    const participantIds = [employee.id, ...colleagueIds];
    const parsed = parsePercentList(text, participantIds.length);
    if (!parsed) {
      await this.telegram.sendMessage(
        employee.telegramChatId,
        `⚠️ Потрібно рівно ${participantIds.length} додатних чисел, через пробіл чи кому. Спробуйте ще раз або /cancel.`,
      );
      return;
    }
    const percents = Object.fromEntries(participantIds.map((id, i) => [id, parsed[i]]));
    await this.pairingPrisma.employee.update({
      where: { id: employee.id },
      data: { telegramPendingPercents: JSON.stringify(percents), telegramAwaitingPercentsInput: false },
    });
    await this.sendConfirmationCard({ ...employee, telegramPendingQty: employee.telegramPendingQty!, telegramPendingPercents: JSON.stringify(percents) });
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
    const equalShare = round2(100 / participantIds.length);
    const customPercents = parsePercentMap(employee.telegramPendingPercents);

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
        allocations: participantIds.map((employeeId) => ({ employeeId, percent: customPercents?.[employeeId] ?? equalShare })),
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

  /**
   * "Сповіщення керівнику в Telegram" (2026-10-01) — every company User
   * holding `production-executions:confirm` who has separately opted in
   * (User.telegramChatId, self-service via /notifications — see
   * UsersService) gets pushed this bot-submitted DRAFT with inline ✅/❌.
   * `submitter` only needs `companyId`/`fullName` — PairedEmployee's own
   * self-submit flow and PairedAdminUser's submit-for-employee flow (2026-
   * 10-05) both satisfy this narrower shape, so the same notification path
   * serves both without a cast.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async notifySupervisors(
    tx: any,
    submitter: { companyId: string; fullName: string },
    executionId: string,
    description: string,
    value: number,
    unit: string,
  ): Promise<void> {
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
  telegramPendingPercents: string | null;
  telegramAwaitingPercentsInput: boolean;
  telegramAwaitingPhotoForExecutionId: string | null;
}

/** The admin "submit work for an employee" identity — see findAdminByChatId and the "Admin flow" section header above. */
interface PairedAdminUser {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  telegramChatId: string;
  canRecord: boolean;
  canConfirm: boolean;
  telegramAdminPendingEmployeeIds: string | null;
  telegramAdminPendingProductionOrderId: string | null;
  telegramAdminPendingWorkTaskId: string | null;
  telegramAdminPendingQty: string | null;
  telegramAdminPendingPercents: string | null;
  telegramAdminAwaitingPercentsInput: boolean;
  telegramAdminAwaitingPhotoForExecutionId: string | null;
  telegramAdminAwaitingSummaryQuery: boolean;
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
  return buildToggleKeyboard(colleagues, selected, 'team:toggle:', 'team:done', 'team:cancel');
}

/** Generic multi-select picker keyboard (2 names per row + a Done/Cancel row) — backs both the Employee colleague picker (`team:*`) and the admin employee picker (`admin:emp:*`), parametrized only by callback_data prefixes so each flow's own namespace never collides with the other's. */
function buildToggleKeyboard(
  items: Array<{ id: string; fullName: string }>,
  selected: string[],
  togglePrefix: string,
  doneData: string,
  cancelData: string,
): TelegramInlineKeyboard {
  const selectedSet = new Set(selected);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(
      items.slice(i, i + 2).map((c) => ({ text: `${selectedSet.has(c.id) ? '✅ ' : ''}${c.fullName}`, callback_data: `${togglePrefix}${c.id}` })),
    );
  }
  rows.push([{ text: `✅ Готово (${selected.length})`, callback_data: doneData }, { text: '❌ Скасувати', callback_data: cancelData }]);
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

type SummaryPeriod = 'today' | 'week' | 'month' | 'all';

/** "📈 Підсумок по працівнику" period picker — 4 fixed presets rather than a free date-range picker, kept deliberately simple for a chat-based report. */
function summaryPeriodRange(period: SummaryPeriod): { start: Date; end: Date; label: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);

  if (period === 'today') {
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { start, end, label: 'сьогодні' };
  }
  if (period === 'week') {
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return { start, end, label: 'останні 7 днів' };
  }
  if (period === 'month') {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end, label: 'цей місяць' };
  }
  return { start: new Date(0), end, label: 'весь час' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `User.telegramAdminPendingPercents`/`Employee.telegramPendingPercents` — a JSON `{employeeId: percent}` map, or null for "no custom override, use equal split". */
function parsePercentMap(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Scales arbitrary positive weights to percentages summing to EXACTLY 100
 * — same rounding-remainder technique as ProductionExecutionsService
 * #buildAllocationRows (round every value but the last, then let the last
 * absorb whatever's left so there's no floating-point drift). Returns
 * null if `text` doesn't contain exactly `count` positive numbers.
 */
function parsePercentList(text: string, count: number): number[] | null {
  const parts = text.split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length !== count) return null;
  const weights = parts.map((p) => Number(p.replace(',', '.')));
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) return null;
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return null;
  const scaled = weights.map((w) => round2((w / sum) * 100));
  const sumExceptLast = scaled.slice(0, -1).reduce((s, v) => s + v, 0);
  scaled[scaled.length - 1] = round2(100 - sumExceptLast);
  return scaled;
}

/** Review-card participants line — "" for a solo submission (nothing to split), otherwise every participant's effective percent (custom override, or the equal-split default) in the SAME order submission will use. */
function formatPercentsLine(participants: Array<{ id: string; label: string }>, customPercents: Record<string, number> | null): string {
  if (participants.length <= 1) return '';
  const equalShare = round2(100 / participants.length);
  const parts = participants.map((p) => `${escapeHtml(p.label)} — ${customPercents?.[p.id] ?? equalShare}%`);
  return `\n👥 Розподіл: ${parts.join(', ')}`;
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
