import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  let provider: any;
  let prisma: any;
  let settingsService: any;
  let actionsService: any;
  let toolsRegistry: any;
  let assembliesService: any;
  let customerOrdersService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    provider = { generateContent: jest.fn() };
    prisma = {
      tenant: {
        role: { findUnique: jest.fn().mockResolvedValue({ permissions: [] }) },
        assembly: { findUnique: jest.fn() },
        productionOrder: { findUnique: jest.fn() },
        product: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    settingsService = { getEffectiveApiKey: jest.fn().mockResolvedValue('test-api-key') };
    actionsService = {
      checkQuota: jest.fn().mockResolvedValue(undefined),
      logUsage: jest.fn().mockResolvedValue(undefined),
      proposeAction: jest.fn(),
      confirmAction: jest.fn(),
      cancelAction: jest.fn(),
    };
    toolsRegistry = { getDeclarations: jest.fn().mockReturnValue([]), executeTool: jest.fn() };
    assembliesService = { calculateCost: jest.fn() };
    customerOrdersService = { findOne: jest.fn() };

    service = new AiService(provider, prisma, settingsService, actionsService, toolsRegistry, assembliesService, customerOrdersService);
  });

  describe('askHelp — instruction-only, zero live-data access (Phase 1 §3.7)', () => {
    it('checks the quota, calls the provider with the manual text embedded, and logs usage', async () => {
      provider.generateContent.mockResolvedValue({ message: { role: 'model', parts: [{ text: 'Тут відповідь' }] } });

      const result = await service.askHelp(user, 'Як додати товар?');

      expect(actionsService.checkQuota).toHaveBeenCalledWith(user);
      const [contents, apiKey] = provider.generateContent.mock.calls[0];
      expect(apiKey).toBe('test-api-key');
      expect(contents[0].parts[0].text).toContain('ІНСТРУКЦІЯ');
      expect(result).toEqual({ answer: 'Тут відповідь' });
      expect(actionsService.logUsage).toHaveBeenCalledWith(user, 'help-assistant', undefined);
    });
  });

  describe('askFullAssistant — model → tool → model loop (AI_FullAssistant.gs port)', () => {
    it('returns immediately when the model answers with no function calls', async () => {
      provider.generateContent.mockResolvedValue({
        message: { role: 'model', parts: [{ text: 'Ось відповідь' }] },
        usage: { totalTokens: 42 },
      });

      const result = await service.askFullAssistant(user, { question: 'Скільки товару X на складі?' } as any);

      expect(result.answer).toBe('Ось відповідь');
      expect(typeof result.history).toBe('string');
      expect(toolsRegistry.executeTool).not.toHaveBeenCalled();
      expect(actionsService.logUsage).toHaveBeenCalledWith(user, 'full-assistant', { totalTokens: 42 });
    });

    it('executes a requested non-critical tool and feeds the result back for a second model turn', async () => {
      provider.generateContent
        .mockResolvedValueOnce({
          message: { role: 'model', parts: [{ functionCall: { name: 'searchProducts', args: { query: 'bolt' } } }] },
        })
        .mockResolvedValueOnce({ message: { role: 'model', parts: [{ text: 'Знайдено 3 товари' }] } });

      toolsRegistry.executeTool.mockResolvedValue({ needsConfirmation: false, result: { count: 3 } });

      const result = await service.askFullAssistant(user, { question: 'Знайди болт' } as any);

      expect(toolsRegistry.executeTool).toHaveBeenCalledWith('searchProducts', { query: 'bolt' }, expect.objectContaining({ user }));
      expect(result.answer).toBe('Знайдено 3 товари');
      expect(provider.generateContent).toHaveBeenCalledTimes(2);
    });

    it('never runs a critical tool inline — proposes a durable PendingAiAction and returns pendingConfirmation instead', async () => {
      provider.generateContent.mockResolvedValueOnce({
        message: { role: 'model', parts: [{ functionCall: { name: 'adjustProductStock', args: { article: 'X', newQty: 5, reason: 'count' } } }] },
      });
      toolsRegistry.executeTool.mockResolvedValue({
        needsConfirmation: true,
        result: { status: 'needs_confirmation', action: 'adjustProductStock', args: { article: 'X', newQty: 5, reason: 'count' }, description: 'Change stock to 5' },
        pendingAction: { action: 'adjustProductStock', args: { article: 'X', newQty: 5, reason: 'count' }, description: 'Change stock to 5' },
      });
      actionsService.proposeAction.mockResolvedValue({ id: 'pa1' });

      const result = await service.askFullAssistant(user, { question: 'Зміни залишок X на 5' } as any);

      expect(actionsService.proposeAction).toHaveBeenCalledWith(user, 'adjustProductStock', { article: 'X', newQty: 5, reason: 'count' }, 'Change stock to 5');
      expect(result.pendingConfirmation).toEqual(
        expect.objectContaining({ pendingActionId: 'pa1', action: 'adjustProductStock', description: 'Change stock to 5' }),
      );
      // Only one model call — the loop must stop at the confirmation, not continue.
      expect(provider.generateContent).toHaveBeenCalledTimes(1);
    });

    it('throws after MAX_TOOL_LOOP_ITERATIONS if the model never stops calling tools', async () => {
      provider.generateContent.mockResolvedValue({
        message: { role: 'model', parts: [{ functionCall: { name: 'searchProducts', args: {} } }] },
      });
      toolsRegistry.executeTool.mockResolvedValue({ needsConfirmation: false, result: { count: 0 } });

      await expect(service.askFullAssistant(user, { question: 'нескінченний цикл' } as any)).rejects.toThrow(BadRequestException);
      expect(provider.generateContent).toHaveBeenCalledTimes(6);
    });
  });

  describe('recognizeInvoice — fuzzy-matches recognized line items against existing Products', () => {
    it('parses the model\'s JSON array and matches by exact/substring name', async () => {
      provider.generateContent.mockResolvedValue({
        message: { role: 'model', parts: [{ text: '[{"name":"Гвинт М6","qty":10}]' }] },
      });
      prisma.tenant.product.findMany.mockResolvedValue([{ article: 'SCR-M6', name: 'Гвинт М6х20' }]);

      const result = await service.recognizeInvoice(user, 'base64...', 'image/jpeg');

      expect(result).toEqual([
        expect.objectContaining({ rawName: 'Гвинт М6', qty: 10, matched: true, article: 'SCR-M6' }),
      ]);
    });

    it('throws BadRequestException when the model does not return valid JSON', async () => {
      provider.generateContent.mockResolvedValue({ message: { role: 'model', parts: [{ text: 'not json at all' }] } });
      await expect(service.recognizeInvoice(user, 'base64...', 'image/jpeg')).rejects.toThrow(BadRequestException);
    });
  });
});
