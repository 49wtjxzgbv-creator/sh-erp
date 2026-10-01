import { HttpException, Injectable, Logger } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramBotPrismaService } from '../../prisma/telegram-bot-prisma.service';
import { FilesService } from '../files/files.service';
import type { FileDomain } from '@prisma/client';
import { CreateProductionExecutionDto } from '../production/dto/production-execution.dto';
import { ProductionExecutionsService } from '../production/production-executions.service';
import { TelegramApiClient } from './telegram-api.client';

const MAX_ORDER_RESULTS = 10;

interface TelegramUpdate {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

/**
 * Core FSM for the Telegram bot (2026-10-01 user request — "бот через
 * який працівники зможуть подавати виконану роботу кожного дня, вона буде
 * надходити на підтвердження і після підтвердження записуватись"). Exactly
 * two steps of real conversation state:
 *
 *   1. Not paired yet -> `/start <code>` resolves the one-time pairing
 *      code generated in ERP (EmployeesService#generateTelegramPairingCode)
 *      via `TelegramBotPrismaService` (BYPASSRLS, employees-only — see
 *      that class's header comment for why this is structurally required
 *      before any tenant context exists).
 *   2. Paired, idle -> any text is treated as an article/name search
 *      against this employee's company's IN_PROGRESS production orders;
 *      tapping a result sets `Employee.telegramPendingProductionOrderId`
 *      and asks for a quantity. The next text message is parsed as that
 *      quantity and submitted as a DRAFT ProductionExecution via the SAME
 *      `ProductionExecutionsService.create()` the web app's "Хід
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
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly pairingPrisma: TelegramBotPrismaService,
    private readonly prisma: PrismaService,
    private readonly productionExecutionsService: ProductionExecutionsService,
    private readonly filesService: FilesService,
    private readonly telegram: TelegramApiClient,
  ) {}

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
      if (employee?.telegramPendingProductionOrderId) {
        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingProductionOrderId: null } });
      }
      await this.telegram.sendMessage(chatId, 'Скасовано.');
      return;
    }

    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код у HR і надішліть: /start КОД');
      return;
    }

    if (employee.telegramPendingProductionOrderId) {
      await this.handleQtyMessage(employee as PairedEmployee, text);
      return;
    }

    await this.handleSearch(employee as PairedEmployee, text);
  }

  private async handleCallbackQuery(callback: { id: string; data?: string; message?: { chat: { id: number } } }): Promise<void> {
    const chatId = callback.message ? String(callback.message.chat.id) : undefined;
    if (!chatId || !callback.data?.startsWith('order:')) {
      await this.telegram.answerCallbackQuery(callback.id);
      return;
    }
    const employee = await this.findByChatId(chatId);
    if (!employee) {
      await this.telegram.answerCallbackQuery(callback.id, 'Ви не прив\'язані.');
      return;
    }
    const productionOrderId = callback.data.slice('order:'.length);

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
      if (!order || order.status !== 'IN_PROGRESS') {
        await this.telegram.answerCallbackQuery(callback.id, 'Це замовлення більше не доступне.');
        return;
      }
      const assembly = await tx.assembly.findUnique({ where: { id: order.assemblyId } });
      await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingProductionOrderId: order.id } });
      await this.telegram.answerCallbackQuery(callback.id);
      await this.telegram.sendMessage(
        chatId,
        `Обрано: <b>${escapeHtml(describeAssembly(assembly))}</b>\nВведіть кількість (число).`,
      );
    });
  }

  // ============================================================
  // Pairing
  // ============================================================

  private async sendWelcome(chatId: string): Promise<void> {
    const employee = await this.findByChatId(chatId);
    if (employee) {
      await this.telegram.sendMessage(chatId, `Вітаю, ${employee.fullName}! Напишіть частину артикулу або назви виробу, щоб здати виконану роботу.`);
    } else {
      await this.telegram.sendMessage(chatId, 'Щоб почати, отримайте код прив\'язки у HR і надішліть: /start КОД');
    }
  }

  private async completePairing(chatId: string, code: string): Promise<void> {
    const employee = await this.pairingPrisma.employee.findFirst({ where: { telegramPairingCode: code } });
    if (!employee) {
      await this.telegram.sendMessage(chatId, 'Невірний код. Перевірте і спробуйте ще раз.');
      return;
    }
    if (!employee.telegramPairingCodeExpiresAt || employee.telegramPairingCodeExpiresAt.getTime() < Date.now()) {
      await this.telegram.sendMessage(chatId, 'Код прострочено — попросіть HR згенерувати новий.');
      return;
    }
    const existing = await this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
    if (existing && existing.id !== employee.id) {
      await this.telegram.sendMessage(chatId, 'Цей Telegram-акаунт уже прив\'язано до іншого співробітника.');
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
    await this.telegram.sendMessage(chatId, `Готово, ${employee.fullName}! Напишіть частину артикулу або назви виробу, щоб здати виконану роботу.`);
  }

  private async findByChatId(chatId: string) {
    return this.pairingPrisma.employee.findFirst({ where: { telegramChatId: chatId } });
  }

  // ============================================================
  // Search + submission
  // ============================================================

  private async handleSearch(employee: PairedEmployee, query: string): Promise<void> {
    if (!query) {
      await this.telegram.sendMessage(employee.telegramChatId, 'Напишіть частину артикулу або назви виробу.');
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const orders = await tx.productionOrder.findMany({ where: { status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, take: 200 });
      const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
      const assemblies = assemblyIds.length ? await tx.assembly.findMany({ where: { id: { in: assemblyIds } } }) : [];
      const assemblyById = new Map(assemblies.map((a) => [a.id, a]));

      const q = query.toLowerCase();
      const matches = orders.filter((o) => {
        const a = assemblyById.get(o.assemblyId);
        if (!a) return false;
        return a.name.toLowerCase().includes(q) || (a.article?.toLowerCase().includes(q) ?? false);
      });

      if (matches.length === 0) {
        await this.telegram.sendMessage(employee.telegramChatId, 'Нічого не знайдено серед активних замовлень. Спробуйте інший текст.');
        return;
      }

      const shown = matches.slice(0, MAX_ORDER_RESULTS);
      const note = matches.length > shown.length ? ` (показано ${shown.length} з ${matches.length} — уточніть пошук, якщо не бачите потрібне)` : '';
      await this.telegram.sendMessage(employee.telegramChatId, `Оберіть виріб${note}:`);

      // One message per result (2026-10-01 user request — "щоб при виборі
      // виробу було також фото"): Telegram's inline keyboards can't show an
      // image per-button, so each match becomes its own sendPhoto, caption
      // = article/name + qty, with the SAME single "обрати" button a plain
      // text result would have had. Falls back to a text-only sendMessage
      // for an assembly with no ASSEMBLY_PHOTO (or whose photo send fails)
      // rather than silently dropping that result from the list.
      const syntheticUser: RequestUser = { userId: employee.telegramLinkedByUserId ?? employee.id, companyId: employee.companyId, email: '', roleId: '' };
      const shownAssemblyIds = Array.from(new Set(shown.map((o) => o.assemblyId)));
      const photosByAssembly: Record<string, Array<{ downloadUrl: string }>> = await this.filesService.listForEntities(
        syntheticUser,
        'Assembly',
        shownAssemblyIds,
        ['ASSEMBLY_PHOTO'] satisfies FileDomain[],
      );

      for (const o of shown) {
        const a = assemblyById.get(o.assemblyId);
        const caption = `${escapeHtml(describeAssembly(a))} (${Number(o.unitsPlanned)} шт)`;
        const button = { inline_keyboard: [[{ text: 'Обрати', callback_data: `order:${o.id}` }]] };
        const photoUrl = photosByAssembly[o.assemblyId]?.[0]?.downloadUrl;
        const sentPhoto = photoUrl ? await this.telegram.sendPhoto(employee.telegramChatId, photoUrl, caption, button) : false;
        if (!sentPhoto) {
          await this.telegram.sendMessage(employee.telegramChatId, caption, button);
        }
      }
    });
  }

  private async handleQtyMessage(employee: PairedEmployee, text: string): Promise<void> {
    const normalized = text.replace(',', '.');
    const qty = Number(normalized);
    if (!Number.isFinite(qty) || qty <= 0) {
      await this.telegram.sendMessage(employee.telegramChatId, 'Введіть додатне число (наприклад 5 або 5.5), або /cancel для скасування.');
      return;
    }

    await this.prisma.runInTenantTransaction({ companyId: employee.companyId, userId: employee.telegramLinkedByUserId ?? employee.id }, async (tx) => {
      const productionOrderId = employee.telegramPendingProductionOrderId!;
      const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
      const assembly = order ? await tx.assembly.findUnique({ where: { id: order.assemblyId } }) : null;

      const syntheticUser: RequestUser = {
        userId: employee.telegramLinkedByUserId ?? employee.id,
        companyId: employee.companyId,
        email: '',
        roleId: '',
      };

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

        await this.pairingPrisma.employee.update({ where: { id: employee.id }, data: { telegramPendingProductionOrderId: null } });
        await this.telegram.sendMessage(
          employee.telegramChatId,
          `✅ Подано на підтвердження: <b>${escapeHtml(describeAssembly(assembly))}</b>, кількість: ${qty}.`,
        );
      } catch (err) {
        await this.telegram.sendMessage(employee.telegramChatId, `⚠️ ${escapeHtml(extractErrorMessage(err))}\nВведіть інше число або /cancel.`);
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
