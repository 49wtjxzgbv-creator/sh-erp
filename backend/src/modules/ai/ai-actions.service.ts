import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiUsage } from './providers/ai-provider.port';
import { AiSettingsService } from './ai-settings.service';
import { AiToolsRegistry } from './tools/tools.registry';
import { loadPermissionSet } from '../../common/authorization/permission-set.util';
import { CodedBadRequestException, CodedForbiddenException, CodedNotFoundException } from '../../common/api-exceptions';

const DEFAULT_PENDING_ACTION_TTL_MINUTES = 10;

/**
 * `PendingAiAction` (Phase 2 §8's durable replacement for the legacy
 * in-memory/token-based `needs_confirmation` pattern) + `AiUsageLog`. A
 * pending action survives a page refresh or an API pod restart — the old
 * stateless-Apps-Script-friendly pattern didn't need to worry about either,
 * but a horizontally-scaled multi-pod API does.
 */
@Injectable()
export class AiActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly toolsRegistry: AiToolsRegistry,
    private readonly settingsService: AiSettingsService,
  ) {}

  async proposeAction(user: RequestUser, action: string, args: Record<string, any>, description: string) {
    const expiresAt = new Date(Date.now() + DEFAULT_PENDING_ACTION_TTL_MINUTES * 60 * 1000);
    const pending = await this.prisma.tenant.pendingAiAction.create({
      data: { userId: user.userId, actionKey: action, args, description, expiresAt } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'ai_action.proposed',
      entityType: 'PendingAiAction',
      entityId: pending.id,
      after: { actionKey: action, description },
    });
    return pending;
  }

  /**
   * Runs the REAL tool logic (`AiTool.execute`) directly — bypassing
   * `AiToolsRegistry.executeTool`'s critical-tool short-circuit, since this
   * IS the explicit, user-confirmed execution path that short-circuit
   * exists to gate. Mirrors `confirmAiAction`'s direct call into the real
   * mutation (e.g. `adjustStock`) in `AI_FullAssistant.gs`.
   */
  async confirmAction(user: RequestUser, pendingActionId: string) {
    const pending = await this.prisma.tenant.pendingAiAction.findUnique({ where: { id: pendingActionId } });
    if (!pending) throw new CodedNotFoundException('AI_PENDING_ACTION_NOT_FOUND', 'Pending AI action not found.');
    if (pending.status !== 'PENDING') {
      throw new CodedBadRequestException('AI_PENDING_ACTION_NOT_PENDING', `This action is no longer pending (status: ${pending.status}).`);
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await this.prisma.tenant.pendingAiAction.update({
        where: { id: pendingActionId },
        data: { status: 'EXPIRED', resolvedAt: new Date() },
      });
      throw new CodedBadRequestException('AI_PENDING_ACTION_EXPIRED', 'This action has expired — ask the assistant again.');
    }

    const tool = this.toolsRegistry.getTool(pending.actionKey);
    if (!tool) throw new CodedBadRequestException('AI_UNKNOWN_ACTION', `Unknown action: ${pending.actionKey}`);

    const permissions = await loadPermissionSet(this.prisma, user);
    const result = await tool.execute(pending.args as any, { user, permissions });

    const resolved = await this.prisma.tenant.pendingAiAction.update({
      where: { id: pendingActionId },
      data: { status: 'CONFIRMED', resolvedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'ai_action.confirmed',
      entityType: 'PendingAiAction',
      entityId: pendingActionId,
      before: pending,
      after: resolved,
    });

    return result;
  }

  async cancelAction(user: RequestUser, pendingActionId: string) {
    const pending = await this.prisma.tenant.pendingAiAction.findUnique({ where: { id: pendingActionId } });
    if (!pending) throw new CodedNotFoundException('AI_PENDING_ACTION_NOT_FOUND', 'Pending AI action not found.');
    if (pending.status !== 'PENDING') {
      throw new CodedBadRequestException('AI_PENDING_ACTION_NOT_PENDING', `This action is no longer pending (status: ${pending.status}).`);
    }

    const updated = await this.prisma.tenant.pendingAiAction.update({
      where: { id: pendingActionId },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'ai_action.cancelled',
      entityType: 'PendingAiAction',
      entityId: pendingActionId,
      before: pending,
      after: updated,
    });
    return updated;
  }

  async logUsage(user: RequestUser, feature: string, usage?: AiUsage) {
    await this.prisma.tenant.aiUsageLog.create({
      data: {
        userId: user.userId,
        feature,
        tokensUsed: usage?.totalTokens,
      } as any,
    });
  }

  /**
   * Disclosed simplification of Phase 2 §8's "cost control" bullet: the
   * architecture doc calls for Redis-token-bucket per-minute rate limiting.
   * No Redis/BullMQ dependency is wired into this codebase yet (Module 9's
   * background-jobs infrastructure, §9, is likewise not built) — this
   * enforces the coarser but still real monthly-quota half
   * (`CompanyAiSettings.monthlyUsageQuota` vs. this month's summed
   * `AiUsageLog.tokensUsed`) via a plain DB aggregate. True per-minute
   * throttling is future work once Redis is actually introduced.
   */
  async checkQuota(user: RequestUser): Promise<void> {
    const quota = await this.settingsService.getMonthlyQuota(user.companyId);
    if (quota == null) return;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const agg = await this.prisma.tenant.aiUsageLog.aggregate({
      _sum: { tokensUsed: true },
      where: { createdAt: { gte: startOfMonth } },
    });
    const used = agg._sum.tokensUsed ?? 0;
    if (used >= quota) {
      throw new CodedForbiddenException('AI_QUOTA_EXCEEDED', `Monthly AI usage quota (${quota} tokens) has been reached for this company.`);
    }
  }
}
