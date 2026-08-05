import { AiTool, AiToolContext } from './ai-tool.interface';
import { AiToolsRegistry } from './tools.registry';

function makeTool(overrides: Partial<AiTool>): AiTool {
  return {
    key: 'testTool',
    description: 'test',
    parameters: { type: 'object', properties: {} },
    execute: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as AiTool;
}

describe('AiToolsRegistry', () => {
  const context: AiToolContext = { user: { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' }, permissions: new Set() };

  it('lists every registered tool as a declaration (name/description/parameters)', () => {
    const registry = new AiToolsRegistry([makeTool({ key: 'a' }), makeTool({ key: 'b' })]);
    const declarations = registry.getDeclarations();
    expect(declarations.map((d) => d.name).sort()).toEqual(['a', 'b']);
  });

  it('runs a non-critical tool directly and returns its result', async () => {
    const execute = jest.fn().mockResolvedValue({ results: [1, 2, 3] });
    const registry = new AiToolsRegistry([makeTool({ key: 'searchProducts', execute })]);

    const outcome = await registry.executeTool('searchProducts', { query: 'bolt' }, context);

    expect(execute).toHaveBeenCalledWith({ query: 'bolt' }, context);
    expect(outcome.needsConfirmation).toBe(false);
    expect(outcome.result).toEqual({ results: [1, 2, 3] });
  });

  it('NEVER calls a critical tool\'s real execute() from the model-driven loop — always short-circuits to needs_confirmation', async () => {
    const execute = jest.fn().mockResolvedValue({ movement: 'this-should-never-run' });
    const describe = jest.fn().mockReturnValue('Change stock to 10');
    const registry = new AiToolsRegistry([makeTool({ key: 'adjustProductStock', critical: true, execute, describe })]);

    const outcome = await registry.executeTool('adjustProductStock', { article: 'X', newQty: 10, reason: 'count' }, context);

    expect(execute).not.toHaveBeenCalled();
    expect(outcome.needsConfirmation).toBe(true);
    expect(outcome.result).toEqual({
      status: 'needs_confirmation',
      action: 'adjustProductStock',
      args: { article: 'X', newQty: 10, reason: 'count' },
      description: 'Change stock to 10',
    });
    expect(outcome.pendingAction).toEqual({ action: 'adjustProductStock', args: { article: 'X', newQty: 10, reason: 'count' }, description: 'Change stock to 10' });
  });

  it('returns an error payload (not a throw) for an unknown tool name', async () => {
    const registry = new AiToolsRegistry([]);
    const outcome = await registry.executeTool('doesNotExist', {}, context);
    expect(outcome.needsConfirmation).toBe(false);
    expect(outcome.result.error).toMatch(/Невідомий інструмент/);
  });

  it('catches a tool execution error and returns it as a result payload rather than throwing', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const registry = new AiToolsRegistry([makeTool({ key: 'flaky', execute })]);
    const outcome = await registry.executeTool('flaky', {}, context);
    expect(outcome.result).toEqual({ error: 'boom' });
  });
});
