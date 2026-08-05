import { RequestUser } from '../../../common/decorators/current-user.decorator';

/**
 * Loaded once per AI request (`AiService.loadContext`), not re-queried per
 * tool call — the same "batch, don't N+1" discipline applied to the
 * reservation/payroll-summary batching in Modules 9-10. `permissions` lets a
 * tool self-restrict (e.g. `GetPayrollSummaryTool` requires `payroll:manage`,
 * matching the legacy `if (user.role !== 'admin')` check in
 * `executeAiTool_`) without each tool issuing its own Role/permissions query.
 */
export interface AiToolContext {
  user: RequestUser;
  permissions: Set<string>;
}

/**
 * Each tool is a small NestJS provider (Phase 2 §8), auto-registered into
 * `AiToolsRegistry`'s tool list via `ai.module.ts`'s `AI_TOOLS` factory
 * provider. Ported 1:1 from `AI_TOOLS_`/`executeAiTool_` in
 * `AI_FullAssistant.gs`.
 */
export interface AiTool {
  readonly key: string;
  readonly description: string;
  /** JSON-schema-shaped parameter declaration, passed to the provider as-is (mirrors the legacy `parameters` field). */
  readonly parameters: Record<string, any>;
  /**
   * Mirrors `AI_CRITICAL_TOOLS_`: a critical tool's `execute()` is the REAL
   * mutation, but `AiToolsRegistry.executeTool` never calls it directly from
   * the model-driven tool loop — it always short-circuits to a
   * `needs_confirmation` response first. `execute()` only actually runs
   * later, from `AiActionsService.confirmAction`, after the user has
   * explicitly clicked confirm.
   */
  readonly critical?: boolean;
  /** Required only for `critical` tools — the human-readable confirmation prompt (mirrors `describeAiAction_`). */
  describe?(args: Record<string, any>): string;
  execute(args: Record<string, any>, context: AiToolContext): Promise<any>;
}

export const AI_TOOLS = 'AI_TOOLS';
