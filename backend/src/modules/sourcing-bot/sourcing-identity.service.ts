import { Injectable, Logger } from '@nestjs/common';
import { SourcingBotPrismaService } from '../../prisma/sourcing-bot-prisma.service';

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
 * checks for a membership specifically in THIS configured company,
 * ignoring any others the user may also belong to.
 */
function getTargetCompanyId(): string {
  const id = process.env.SOURCING_BOT_COMPANY_ID;
  if (!id) throw new Error('SOURCING_BOT_COMPANY_ID is not set.');
  return id;
}

export interface ResolvedSourcingIdentity {
  userId: string;
  companyId: string;
  fullName: string;
  isAdmin: boolean;
}

/**
 * Identity resolution shared by BOTH the bot's chat FSM
 * (`SourcingBotService`) and the Mini App's HTTP API
 * (`TelegramWebAppAuthGuard`) — extracted (2026-11-10, "веб версію як
 * застосунок") from what used to be `SourcingBotService#resolveIdentity`
 * so the two entry points can never drift out of sync on "who counts as
 * paired, in which company, with how much access." Both run in the SAME
 * process (see `main.ts`'s header comment), so this one injectable
 * instance's in-memory cache is naturally shared between a chat message
 * and an API call from the same paired user.
 */
@Injectable()
export class SourcingIdentityService {
  private readonly logger = new Logger(SourcingIdentityService.name);
  private readonly cache = new Map<string, ResolvedSourcingIdentity>();

  constructor(private readonly pairingPrisma: SourcingBotPrismaService) {}

  /** `chatId` doubles as the Telegram user id as a string — true for any private 1:1 chat with this bot, which is the only kind this bot ever has. */
  async resolveByChatId(chatId: string): Promise<ResolvedSourcingIdentity | null> {
    const cached = this.cache.get(chatId);
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

    const identity: ResolvedSourcingIdentity = { userId: user.id, companyId, fullName: user.fullName, isAdmin };
    this.cache.set(chatId, identity);
    return identity;
  }

  invalidate(chatId: string): void {
    this.cache.delete(chatId);
  }
}
