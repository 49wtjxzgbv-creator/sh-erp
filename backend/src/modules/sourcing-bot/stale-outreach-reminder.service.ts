import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SourcingBotApiClient } from './sourcing-bot-api.client';
import { STATUS_LABELS } from './sourcing-shared';

/** Same reasoning as SourcingIdentityService's own copy — "who can manage purchase orders" is the established proxy for "procurement staff," reused rather than duplicated as a new permission. */
const ADMIN_PERMISSION_KEY = 'purchase-orders:manage';
const SYSTEM_ACTOR = 'sourcing-bot-reminder';
const STALE_AFTER_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getTargetCompanyId(): string | null {
  return process.env.SOURCING_BOT_COMPANY_ID ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * "нагадування про 'зависле' outreach — якщо постачальника позначили
 * 'Написали'/'Очікуємо відповідь' і минуло, наприклад, 3+ дні без
 * оновлення статусу — push-повідомлення в Telegram" (2026-11-10). A
 * candidate sitting in CONTACTED/AWAITING_RESPONSE with no status change
 * in `STALE_AFTER_DAYS` days is exactly the "forgot to follow up" case
 * this whole tool exists to catch.
 *
 * 07:00 UTC ≈ start of a Europe/Kyiv workday — same single-process-wide-
 * UTC-cron disclosed simplification as TelegramBotService#sendDailyReminders
 * (no true per-company timezone scheduling; this bot only ever serves one
 * company anyway, see SourcingIdentityService's own header comment on
 * why — so the simplification costs nothing extra here).
 */
@Injectable()
export class StaleOutreachReminderService {
  private readonly logger = new Logger(StaleOutreachReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: SourcingBotApiClient,
  ) {}

  @Cron('0 7 * * *')
  async sendStaleOutreachReminders(): Promise<void> {
    const companyId = getTargetCompanyId();
    if (!companyId || !process.env.SOURCING_BOT_TELEGRAM_TOKEN) return;

    try {
      await this.prisma.runInTenantTransaction({ companyId, userId: SYSTEM_ACTOR }, async (tx) => {
        const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * MS_PER_DAY);
        const stale = await tx.sourcingOutreach.findMany({
          where: { status: { in: ['CONTACTED', 'AWAITING_RESPONSE'] }, updatedAt: { lt: cutoff } },
          include: { candidate: { include: { category: true } } },
          orderBy: { updatedAt: 'asc' },
        });
        if (stale.length === 0) return;

        const memberships = await tx.companyMembership.findMany({
          where: { companyId },
          include: { user: true, role: { include: { permissions: { include: { permission: true } } } } },
        });
        const adminChatIds = memberships
          .filter((m: any) => m.user.sourcingBotChatId && m.role.permissions.some((rp: any) => rp.permission.key === ADMIN_PERMISSION_KEY))
          .map((m: any) => m.user.sourcingBotChatId as string);
        if (adminChatIds.length === 0) return;

        const lines = stale.map((o: any) => {
          const days = Math.floor((Date.now() - o.updatedAt.getTime()) / MS_PER_DAY);
          return `• <b>${escapeHtml(o.candidate.name)}</b> (${escapeHtml(o.candidate.category.name)}) — ${STATUS_LABELS[o.status as keyof typeof STATUS_LABELS]}, ${days} дн. без оновлення`;
        });
        const message = `⏰ Застаріле листування — потребує уваги (${stale.length}):\n\n${lines.join('\n')}`;

        for (const chatId of adminChatIds) {
          await this.telegram.sendMessage(chatId, message);
        }
      });
    } catch (err) {
      this.logger.warn(`sendStaleOutreachReminders failed: ${String(err)}`);
    }
  }
}
