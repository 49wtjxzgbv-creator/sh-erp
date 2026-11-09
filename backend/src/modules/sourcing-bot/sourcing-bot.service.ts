import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { SourcingOutreachStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SourcingBotPrismaService } from '../../prisma/sourcing-bot-prisma.service';
import { SourcingBotApiClient, TelegramInlineKeyboard, TelegramUpdate } from './sourcing-bot-api.client';

/** Reused rather than inventing a new permission — "who can manage purchase orders" is a reasonable proxy for "procurement staff trusted to add a new candidate supplier" in this company's role setup. */
const ADMIN_PERMISSION_KEY = 'purchase-orders:manage';

/**
 * This bot's sourcing data lives entirely in ONE company (2026-11-09 user
 * correction: "ми все це робимо тільки для компанії 131313" — this
 * company's own ERP spans several legally-separate businesses sharing one
 * installation, and a staff member can easily hold membership in more than
 * one of them). Rather than guessing a companyId from "how many
 * memberships does this user have" (fragile — breaks the moment a sourcing
 * team member also happens to have access to an unrelated company), this
 * bot checks for a membership specifically in THIS configured company,
 * ignoring any others the user may also belong to.
 */
function getTargetCompanyId(): string {
  const id = process.env.SOURCING_BOT_COMPANY_ID;
  if (!id) throw new Error('SOURCING_BOT_COMPANY_ID is not set.');
  return id;
}

const PRICE_FIELDS = [
  { field: 'germanPriceExclVat' as const, label: 'DE без ПДВ' },
  { field: 'germanPriceInclVat' as const, label: 'DE з ПДВ' },
  { field: 'localPriceExclVat' as const, label: 'UA без ПДВ' },
  { field: 'localPriceInclVat' as const, label: 'UA з ПДВ' },
  { field: 'sellPriceEur' as const, label: 'Наша ціна продажу' },
];
type PriceField = (typeof PRICE_FIELDS)[number]['field'];

const STATUS_LABELS: Record<SourcingOutreachStatus, string> = {
  NOT_CONTACTED: '⬜ Не написали',
  CONTACTED: '✉️ Написали',
  AWAITING_RESPONSE: '⏳ Чекаємо відповідь',
  RESPONDED: '💬 Відповіли',
  QUOTE_RECEIVED: '💰 Є ціна',
  REJECTED: '❌ Відмовили',
  WON: '🏆 Домовились',
};

/** Short multi-step flows (entering a quoted price + note, fixing a price field, adding a new candidate) — kept in-memory, not persisted. See SourcingBotModule's own header comment for why losing this on a rare restart is an acceptable simplification here (unlike the production-notifications bot's FSM, nothing here represents already-committed business data mid-flight). */
type PendingAction =
  | { kind: 'note'; candidateSupplierId: string }
  | { kind: 'quote_price'; candidateSupplierId: string }
  | { kind: 'quote_note'; candidateSupplierId: string; priceEur: number }
  | { kind: 'fix_price'; productId: string; field: PriceField }
  | { kind: 'add_candidate'; categoryId: string };

interface ResolvedIdentity {
  userId: string;
  companyId: string;
  fullName: string;
  isAdmin: boolean;
}

/**
 * Core logic for the procurement sourcing bot (2026-11-09 — "потрібен
 * якийсь зручний бот телеграм щоб це всек було зручно опрацьовувати по
 * категоріях з списком можливих постачальників текстом який писати та
 * наявною ціною"). A SEPARATE bot/process from TelegramBotModule's
 * production-notifications bot — see SourcingBotModule's header comment
 * for the full isolation rationale (own token, own systemd unit, own
 * BYPASSRLS Postgres role).
 *
 * Flow:
 *   1. Not paired -> `/start <code>` (UsersService#generateSourcingBotPairingCode,
 *      a button on /notifications mirroring the existing Telegram one).
 *   2. Main menu -> pick a `SourcingCategory`.
 *   3. Category view -> "📋 Текст запиту" (the category's rfqTemplate,
 *      verbatim, copy-pasteable), "💰 Поточні ціни" (every linked
 *      Product's real germanPrice/localPrice/sellPriceEur fields — NOT a
 *      shadow copy, see Product.sourcingCategoryId's own schema comment),
 *      and the category's candidate suppliers as buttons.
 *   4. Candidate view -> contact details + current SourcingOutreach.status
 *      + action buttons (✅ Написав / 📩 Відповіли / ❌ Відмовили /
 *      🏆 Домовились / 💬 Нотатка / 💰 Внести ціну).
 *   5. "📊 Статус" -> cross-category list of every candidate's status.
 *   6. Admin-only "➕ Додати постачальника" (gated on
 *      ADMIN_PERMISSION_KEY) -> one free-text message, semicolon-separated
 *      fields, creates a new SourcingCandidateSupplier + its NOT_CONTACTED
 *      SourcingOutreach row.
 *
 * Identity resolution mirrors TelegramBotService's pairing shape (see that
 * file's own header comment) but is deliberately simpler: once a chat
 * resolves to a User, this bot assumes that User belongs to exactly one
 * company (true for this deployment) and caches {userId, companyId,
 * isAdmin} in memory for the process lifetime, re-resolved only on
 * `/start`. If that single-company assumption ever breaks, the user gets
 * told to contact an admin rather than the bot guessing which company.
 */
@Injectable()
export class SourcingBotService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SourcingBotService.name);
  private running = false;
  private updateOffset = 0;

  private readonly identityCache = new Map<string, ResolvedIdentity>();
  private readonly pending = new Map<string, PendingAction>();

  constructor(
    private readonly pairingPrisma: SourcingBotPrismaService,
    private readonly prisma: PrismaService,
    private readonly telegram: SourcingBotApiClient,
  ) {}

  onModuleInit(): void {
    if (!process.env.SOURCING_BOT_TELEGRAM_TOKEN) {
      this.logger.warn('SOURCING_BOT_TELEGRAM_TOKEN not set — the sourcing bot will not start.');
      return;
    }
    this.running = true;
    void this.pollLoop();
  }

  onApplicationShutdown(): void {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const updates = await this.telegram.getUpdates(this.updateOffset);
      for (const update of updates) {
        this.updateOffset = update.update_id + 1;
        try {
          await this.handleUpdate(update);
        } catch (err) {
          this.logger.error(`Failed handling update ${update.update_id}: ${String(err)}`);
        }
      }
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    if (update.message?.text !== undefined) {
      await this.handleMessage(String(update.message.chat.id), update.message.text.trim());
    }
  }

  // ============================================================
  // Pairing / identity
  // ============================================================

  private async resolveIdentity(chatId: string): Promise<ResolvedIdentity | null> {
    const cached = this.identityCache.get(chatId);
    if (cached) return cached;

    const user = await this.pairingPrisma.user.findFirst({ where: { sourcingBotChatId: chatId } });
    if (!user) return null;

    const companyId = getTargetCompanyId();
    const membership = await this.pairingPrisma.companyMembership.findFirst({ where: { userId: user.id, companyId } });
    if (!membership) {
      this.logger.warn(`User ${user.id} has no membership in the configured sourcing-bot company ${companyId}.`);
      return null;
    }
    const role = await this.pairingPrisma.role.findUnique({
      where: { id: membership.roleId },
      include: { permissions: { include: { permission: true } } },
    });
    const isAdmin = role?.permissions.some((rp) => rp.permission.key === ADMIN_PERMISSION_KEY) ?? false;

    const identity: ResolvedIdentity = { userId: user.id, companyId, fullName: user.fullName, isAdmin };
    this.identityCache.set(chatId, identity);
    return identity;
  }

  private async completePairing(chatId: string, rawCode: string): Promise<void> {
    const code = rawCode.toUpperCase();
    const user = await this.pairingPrisma.user.findFirst({ where: { sourcingBotPairingCode: code } });
    if (!user) {
      await this.telegram.sendMessage(chatId, '❌ Невірний код. Перевірте і спробуйте ще раз.');
      return;
    }
    if (!user.sourcingBotPairingCodeExpiresAt || user.sourcingBotPairingCodeExpiresAt.getTime() < Date.now()) {
      await this.telegram.sendMessage(chatId, '⌛ Код прострочено — згенеруйте новий на сторінці «Сповіщення».');
      return;
    }
    const existing = await this.pairingPrisma.user.findFirst({ where: { sourcingBotChatId: chatId } });
    if (existing && existing.id !== user.id) {
      await this.telegram.sendMessage(chatId, '⚠️ Цей Telegram-акаунт уже прив\'язано до іншого користувача.');
      return;
    }

    await this.pairingPrisma.user.update({
      where: { id: user.id },
      data: { sourcingBotChatId: chatId, sourcingBotPairingCode: null, sourcingBotPairingCodeExpiresAt: null },
    });
    this.identityCache.delete(chatId);
    await this.telegram.sendMessage(chatId, `✅ Готово, ${user.fullName}! Ось список категорій для пошуку постачальників:`);
    await this.sendMainMenu(chatId);
  }

  // ============================================================
  // Message / callback dispatch
  // ============================================================

  private async handleMessage(chatId: string, text: string): Promise<void> {
    if (text.startsWith('/start')) {
      const code = text.replace('/start', '').trim();
      if (code) {
        await this.completePairing(chatId, code);
      } else {
        const identity = await this.resolveIdentity(chatId);
        if (identity) {
          await this.telegram.sendMessage(chatId, `👋 Вітаю, ${identity.fullName}!`);
          await this.sendMainMenu(chatId);
        } else {
          await this.telegram.sendMessage(chatId, 'Щоб почати, згенеруйте код на сторінці «Сповіщення» в ERP і надішліть: /start КОД');
        }
      }
      return;
    }

    if (text === '/cancel') {
      this.pending.delete(chatId);
      await this.telegram.sendMessage(chatId, '❌ Скасовано.');
      return;
    }

    const identity = await this.resolveIdentity(chatId);
    if (!identity) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код на сторінці «Сповіщення» і надішліть: /start КОД');
      return;
    }

    const pendingAction = this.pending.get(chatId);
    if (pendingAction) {
      await this.handlePendingInput(chatId, identity, pendingAction, text);
      return;
    }

    if (text === '/status' || text === '📊 Статус') {
      await this.sendStatusOverview(chatId, identity);
      return;
    }

    await this.sendMainMenu(chatId);
  }

  private async handleCallback(cb: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }): Promise<void> {
    const chatId = String(cb.message?.chat.id);
    const data = cb.data ?? '';
    await this.telegram.answerCallbackQuery(cb.id);

    const identity = await this.resolveIdentity(chatId);
    if (!identity) {
      await this.telegram.sendMessage(chatId, 'Ви ще не прив\'язані. Отримайте код на сторінці «Сповіщення» і надішліть: /start КОД');
      return;
    }

    const [action, ...rest] = data.split(':');
    switch (action) {
      case 'menu':
        await this.sendMainMenu(chatId);
        return;
      case 'cat':
        await this.sendCategory(chatId, identity, rest[0]);
        return;
      case 'rfq':
        await this.sendRfqText(chatId, identity, rest[0]);
        return;
      case 'prices':
        await this.sendPriceList(chatId, identity, rest[0]);
        return;
      case 'fixprice':
        await this.startFixPrice(chatId, rest[0], rest[1] as PriceField);
        return;
      case 'cand':
        await this.sendCandidate(chatId, identity, rest[0]);
        return;
      case 'setstatus':
        await this.setOutreachStatus(chatId, identity, rest[0], rest[1] as SourcingOutreachStatus);
        return;
      case 'note':
        this.pending.set(chatId, { kind: 'note', candidateSupplierId: rest[0] });
        await this.telegram.sendMessage(chatId, '✍️ Напишіть нотатку одним повідомленням (/cancel — скасувати):');
        return;
      case 'quote':
        this.pending.set(chatId, { kind: 'quote_price', candidateSupplierId: rest[0] });
        await this.telegram.sendMessage(chatId, '💰 Яку ціну назвав постачальник? (число, напр. 150.50) /cancel — скасувати:');
        return;
      case 'status':
        await this.sendStatusOverview(chatId, identity);
        return;
      case 'addcandidate':
        if (!identity.isAdmin) {
          await this.telegram.sendMessage(chatId, '⛔ Цю дію може виконати тільки адміністратор закупівель.');
          return;
        }
        this.pending.set(chatId, { kind: 'add_candidate', categoryId: rest[0] });
        await this.telegram.sendMessage(
          chatId,
          '➕ Надішліть одним повідомленням, розділяючи крапкою з комою:\n' +
            '<i>Назва; Локація; Телефон; Email; Сайт; Що роблять</i>\n\n' +
            'Поля email/сайт/що роблять можна лишити порожніми (просто крапка з комою підряд). /cancel — скасувати.',
        );
        return;
    }
  }

  // ============================================================
  // Views
  // ============================================================

  private mainMenuKeyboard(categories: Array<{ id: string; name: string }>): TelegramInlineKeyboard {
    return {
      inline_keyboard: [
        ...categories.map((c) => [{ text: c.name, callback_data: `cat:${c.id}` }]),
        [{ text: '📊 Статус по всіх постачальниках', callback_data: 'status' }],
      ],
    };
  }

  private async sendMainMenu(chatId: string): Promise<void> {
    const identity = await this.resolveIdentity(chatId);
    if (!identity) return;
    const categories = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    );
    if (categories.length === 0) {
      await this.telegram.sendMessage(chatId, 'Поки немає жодної категорії пошуку постачальників.');
      return;
    }
    await this.telegram.sendMessage(chatId, '📂 Оберіть категорію:', this.mainMenuKeyboard(categories));
  }

  private async sendCategory(chatId: string, identity: ResolvedIdentity, categoryId: string): Promise<void> {
    const category = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingCategory.findUnique({
        where: { id: categoryId },
        include: { candidates: { where: { deletedAt: null }, include: { outreach: true }, orderBy: { createdAt: 'asc' } } },
      }),
    );
    if (!category) {
      await this.telegram.sendMessage(chatId, 'Категорію не знайдено.');
      return;
    }

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Текст запиту', callback_data: `rfq:${category.id}` }],
        [{ text: '💰 Поточні ціни', callback_data: `prices:${category.id}` }],
        ...category.candidates.map((c) => [
          { text: `${STATUS_LABELS[c.outreach?.status ?? 'NOT_CONTACTED']} ${c.name}`, callback_data: `cand:${c.id}` },
        ]),
        ...(identity.isAdmin ? [[{ text: '➕ Додати постачальника', callback_data: `addcandidate:${category.id}` }]] : []),
        [{ text: '⬅️ Категорії', callback_data: 'menu' }],
      ],
    };
    await this.telegram.sendMessage(chatId, `<b>${category.name}</b>`, keyboard);
  }

  private async sendRfqText(chatId: string, identity: ResolvedIdentity, categoryId: string): Promise<void> {
    const category = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingCategory.findUnique({ where: { id: categoryId }, select: { rfqTemplate: true } }),
    );
    if (!category) return;
    await this.telegram.sendMessage(chatId, category.rfqTemplate);
  }

  private formatPrice(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'object' && 'toNumber' in (value as any) ? (value as any).toNumber() : Number(value);
    return `€${n.toFixed(2)}`;
  }

  private async sendPriceList(chatId: string, identity: ResolvedIdentity, categoryId: string): Promise<void> {
    const products = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.product.findMany({
        where: { sourcingCategoryId: categoryId, deletedAt: null },
        orderBy: { article: 'asc' },
        select: { id: true, article: true, name: true, germanPriceExclVat: true, germanPriceInclVat: true, localPriceExclVat: true, localPriceInclVat: true, sellPriceEur: true },
      }),
    );
    if (products.length === 0) {
      await this.telegram.sendMessage(chatId, 'У цій категорії ще немає товарів з прив\'язкою.');
      return;
    }

    for (const p of products) {
      const parts = PRICE_FIELDS.map(({ field, label }) => {
        const formatted = this.formatPrice(p[field]);
        return formatted ? `${label}: ${formatted}` : null;
      }).filter((x): x is string => x !== null);

      const text = `<b>${p.article}</b> ${p.name}\n${parts.length > 0 ? parts.join(' · ') : '<i>жодна ціна не вказана</i>'}`;
      const keyboard: TelegramInlineKeyboard = {
        inline_keyboard: [
          PRICE_FIELDS.map(({ field, label }) => ({ text: `✏️ ${label}`, callback_data: `fixprice:${p.id}:${field}` })),
        ],
      };
      await this.telegram.sendMessage(chatId, text, keyboard);
    }
  }

  private async startFixPrice(chatId: string, productId: string, field: PriceField): Promise<void> {
    const label = PRICE_FIELDS.find((f) => f.field === field)?.label ?? field;
    this.pending.set(chatId, { kind: 'fix_price', productId, field });
    await this.telegram.sendMessage(chatId, `✏️ Введіть нове значення для «${label}» (число, напр. 123.45; «-» щоб очистити). /cancel — скасувати.`);
  }

  private async sendCandidate(chatId: string, identity: ResolvedIdentity, candidateId: string): Promise<void> {
    const candidate = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingCandidateSupplier.findUnique({ where: { id: candidateId }, include: { outreach: true } }),
    );
    if (!candidate) {
      await this.telegram.sendMessage(chatId, 'Постачальника не знайдено.');
      return;
    }

    const lines = [
      `<b>${candidate.name}</b>`,
      candidate.location ? `📍 ${candidate.location}` : null,
      candidate.phone ? `📞 ${candidate.phone}` : null,
      candidate.email ? `✉️ ${candidate.email}` : null,
      candidate.website ? `🌐 ${candidate.website}` : null,
      candidate.whatTheyDo ? `🛠 ${candidate.whatTheyDo}` : null,
      '',
      `Статус: ${STATUS_LABELS[candidate.outreach?.status ?? 'NOT_CONTACTED']}`,
      candidate.outreach?.lastNote ? `Нотатка: ${candidate.outreach.lastNote}` : null,
      candidate.outreach?.quotedPriceEur ? `Остання названа ціна: €${candidate.outreach.quotedPriceEur.toFixed(2)}${candidate.outreach.quotedPriceNote ? ` (${candidate.outreach.quotedPriceNote})` : ''}` : null,
    ].filter((x): x is string => x !== null);

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Написав', callback_data: `setstatus:${candidate.id}:CONTACTED` },
          { text: '📩 Відповіли', callback_data: `setstatus:${candidate.id}:RESPONDED` },
        ],
        [
          { text: '❌ Відмовили', callback_data: `setstatus:${candidate.id}:REJECTED` },
          { text: '🏆 Домовились', callback_data: `setstatus:${candidate.id}:WON` },
        ],
        [
          { text: '💬 Нотатка', callback_data: `note:${candidate.id}` },
          { text: '💰 Внести ціну', callback_data: `quote:${candidate.id}` },
        ],
        [{ text: '⬅️ Назад до категорії', callback_data: `cat:${candidate.categoryId}` }],
      ],
    };
    await this.telegram.sendMessage(chatId, lines.join('\n'), keyboard);
  }

  private async setOutreachStatus(chatId: string, identity: ResolvedIdentity, candidateId: string, status: SourcingOutreachStatus): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingOutreach.update({
        where: { companyId_candidateSupplierId: { companyId: identity.companyId, candidateSupplierId: candidateId } },
        data: { status, contactedByUserId: identity.userId, contactedAt: new Date() },
      }),
    );
    await this.telegram.sendMessage(chatId, `Статус оновлено: ${STATUS_LABELS[status]}`);
    await this.sendCandidate(chatId, identity, candidateId);
  }

  private async sendStatusOverview(chatId: string, identity: ResolvedIdentity): Promise<void> {
    const candidates = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
      tx.sourcingCandidateSupplier.findMany({
        where: { deletedAt: null },
        include: { outreach: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
    );
    if (candidates.length === 0) {
      await this.telegram.sendMessage(chatId, 'Поки немає жодного постачальника.');
      return;
    }
    const byCategory = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const key = c.category.name;
      byCategory.set(key, [...(byCategory.get(key) ?? []), c]);
    }
    const blocks: string[] = [];
    for (const [categoryName, rows] of byCategory) {
      const lines = rows.map((c) => `  ${STATUS_LABELS[c.outreach?.status ?? 'NOT_CONTACTED']} — ${c.name}`);
      blocks.push(`<b>${categoryName}</b>\n${lines.join('\n')}`);
    }
    await this.telegram.sendMessage(chatId, blocks.join('\n\n'));
  }

  // ============================================================
  // Pending free-text input (note / quote price+note / fix price / add candidate)
  // ============================================================

  private async handlePendingInput(chatId: string, identity: ResolvedIdentity, action: PendingAction, text: string): Promise<void> {
    switch (action.kind) {
      case 'note': {
        this.pending.delete(chatId);
        await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
          tx.sourcingOutreach.update({
            where: { companyId_candidateSupplierId: { companyId: identity.companyId, candidateSupplierId: action.candidateSupplierId } },
            data: { lastNote: text },
          }),
        );
        await this.telegram.sendMessage(chatId, '✅ Нотатку збережено.');
        await this.sendCandidate(chatId, identity, action.candidateSupplierId);
        return;
      }
      case 'quote_price': {
        const price = this.parseDecimal(text);
        if (price === null) {
          await this.telegram.sendMessage(chatId, 'Не схоже на число. Спробуйте ще раз (напр. 150.50) або /cancel.');
          return;
        }
        this.pending.set(chatId, { kind: 'quote_note', candidateSupplierId: action.candidateSupplierId, priceEur: price });
        await this.telegram.sendMessage(chatId, 'Нотатка до ціни (напр. "з ПДВ", "за 100 шт") — або "-" щоб пропустити:');
        return;
      }
      case 'quote_note': {
        this.pending.delete(chatId);
        const note = text === '-' ? null : text;
        await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
          tx.sourcingOutreach.update({
            where: { companyId_candidateSupplierId: { companyId: identity.companyId, candidateSupplierId: action.candidateSupplierId } },
            data: { status: 'QUOTE_RECEIVED', quotedPriceEur: action.priceEur, quotedPriceNote: note, contactedByUserId: identity.userId, contactedAt: new Date() },
          }),
        );
        await this.telegram.sendMessage(chatId, '✅ Ціну збережено.');
        await this.sendCandidate(chatId, identity, action.candidateSupplierId);
        return;
      }
      case 'fix_price': {
        const value = text === '-' ? null : this.parseDecimal(text);
        if (text !== '-' && value === null) {
          await this.telegram.sendMessage(chatId, 'Не схоже на число. Спробуйте ще раз (напр. 123.45; «-» щоб очистити) або /cancel.');
          return;
        }
        this.pending.delete(chatId);
        await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, (tx) =>
          tx.product.update({ where: { id: action.productId }, data: { [action.field]: value } }),
        );
        await this.telegram.sendMessage(chatId, '✅ Ціну оновлено в каталозі.');
        return;
      }
      case 'add_candidate': {
        const parts = text.split(';').map((p) => p.trim());
        const [name, location, phone, email, website, whatTheyDo] = parts;
        if (!name) {
          await this.telegram.sendMessage(chatId, 'Потрібна хоча би назва. Спробуйте ще раз або /cancel.');
          return;
        }
        this.pending.delete(chatId);
        // Two separate top-level creates, not a nested `outreach: { create }`
        // — the tenant-scoping extension only auto-stamps companyId onto
        // the entry-point row of a top-level operation (see its own header
        // comment's disclosed limitation), so a nested create would need
        // companyId threaded through by hand anyway; two plain creates are
        // simpler and get it from the extension for free on both.
        const created = await this.prisma.runInTenantTransaction({ companyId: identity.companyId, userId: identity.userId }, async (tx) => {
          const candidate = await tx.sourcingCandidateSupplier.create({
            data: {
              categoryId: action.categoryId,
              name,
              location: location || null,
              phone: phone || null,
              email: email || null,
              website: website || null,
              whatTheyDo: whatTheyDo || null,
              source: 'user_added',
            } as any,
          });
          await tx.sourcingOutreach.create({ data: { candidateSupplierId: candidate.id, status: 'NOT_CONTACTED' } as any });
          return candidate;
        });
        await this.telegram.sendMessage(chatId, `✅ Додано: ${created.name}`);
        await this.sendCategory(chatId, identity, action.categoryId);
        return;
      }
    }
  }

  private parseDecimal(text: string): number | null {
    const normalized = text.replace(',', '.').trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
}
