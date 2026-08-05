import { Inject, Injectable } from '@nestjs/common';
import { AiToolDeclaration } from '../providers/ai-provider.port';
import { AI_TOOLS, AiTool, AiToolContext } from './ai-tool.interface';

export interface AiToolExecutionResult {
  needsConfirmation: boolean;
  result: any;
  pendingAction?: { action: string; args: Record<string, any>; description: string };
}

/**
 * Collects every `AiTool` provider (bound via `AI_TOOLS` in `ai.module.ts`)
 * into one lookup, ported from `AI_TOOLS_`/`AI_CRITICAL_TOOLS_`/`executeAiTool_`
 * in `AI_FullAssistant.gs`. This is the single place that enforces "a
 * critical tool's real logic is never reachable from the model-driven tool
 * loop" — see `AiTool.critical`'s own doc comment.
 */
@Injectable()
export class AiToolsRegistry {
  private readonly toolsByKey = new Map<string, AiTool>();

  constructor(@Inject(AI_TOOLS) tools: AiTool[]) {
    for (const tool of tools) {
      this.toolsByKey.set(tool.key, tool);
    }
  }

  getDeclarations(): AiToolDeclaration[] {
    return Array.from(this.toolsByKey.values()).map((t) => ({ name: t.key, description: t.description, parameters: t.parameters }));
  }

  getTool(key: string): AiTool | undefined {
    return this.toolsByKey.get(key);
  }

  /**
   * Dispatches one model-requested tool call. Critical tools NEVER run
   * their real `execute()` here — this always returns a `needs_confirmation`
   * shape instead (mirroring `AI_CRITICAL_TOOLS_[name]` short-circuiting
   * BEFORE dispatch in the legacy code), regardless of what the model
   * actually asked to do.
   */
  async executeTool(name: string, args: Record<string, any>, context: AiToolContext): Promise<AiToolExecutionResult> {
    const tool = this.toolsByKey.get(name);
    if (!tool) {
      return { needsConfirmation: false, result: { error: `Невідомий інструмент: ${name}` } };
    }

    if (tool.critical) {
      const description = tool.describe ? tool.describe(args) : `Дія: ${name}`;
      return {
        needsConfirmation: true,
        result: { status: 'needs_confirmation', action: name, args, description },
        pendingAction: { action: name, args, description },
      };
    }

    try {
      const result = await tool.execute(args, context);
      return { needsConfirmation: false, result };
    } catch (e: any) {
      return { needsConfirmation: false, result: { error: e?.message ?? String(e) } };
    }
  }
}
