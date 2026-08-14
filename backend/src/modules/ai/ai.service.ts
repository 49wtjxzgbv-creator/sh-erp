import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { CustomerOrdersService } from '../sales/customer-orders.service';
import { HELP_MANUAL_TEXT } from './help-manual.constant';
import { AI_PROVIDER_PORT, AiGenerateResult, AiMessage, AiProviderException, AiProviderPort, AiToolDeclaration } from './providers/ai-provider.port';
import { AiActionsService } from './ai-actions.service';
import { AiSettingsService } from './ai-settings.service';
import { AiToolsRegistry } from './tools/tools.registry';
import { loadPermissionSet } from '../../common/authorization/permission-set.util';
import { AskFullAssistantDto } from './dto/ask-full-assistant.dto';

const MAX_TOOL_LOOP_ITERATIONS = 6; // mirrors the legacy askFullAssistant's maxIterations

/**
 * Top-level AI orchestration (Phase 2 §8 / Phase 1 §3.7). Three entry
 * points, ported 1:1 from Gemini.gs / AI_FullAssistant.gs:
 *  - `askHelp`: the "Довідник" — instruction-only, zero live-data access.
 *  - `askFullAssistant`: the function-calling assistant over `AiToolsRegistry`'s
 *    tool catalogue, with the critical-action confirmation hand-off.
 *  - `askAboutCustomerOrder`: narrowly-scoped Q&A over one specific order's
 *    real data.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER_PORT) private readonly provider: AiProviderPort,
    private readonly prisma: PrismaService,
    private readonly settingsService: AiSettingsService,
    private readonly actionsService: AiActionsService,
    private readonly toolsRegistry: AiToolsRegistry,
    private readonly assembliesService: AssembliesService,
    private readonly customerOrdersService: CustomerOrdersService,
  ) {}

  async askHelp(user: RequestUser, question: string) {
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const systemPrompt =
      'Ти — довідковий асистент системи "SH ERP" (склад і виробництво). ' +
      'Відповідай КОРОТКО, українською мовою, спираючись ВИКЛЮЧНО на інструкцію нижче. ' +
      'Не вигадуй кнопок, розділів чи функцій, яких немає в інструкції. ' +
      'Якщо відповіді в інструкції немає — чесно скажи, що не маєш такої інформації, і порадь звернутись до адміністратора. ' +
      'Не обговорюй нічого, що не стосується роботи із застосунком.\n\n=== ІНСТРУКЦІЯ ===\n' +
      HELP_MANUAL_TEXT +
      '\n\n=== ЗАПИТАННЯ КОРИСТУВАЧА ===\n' +
      question;

    const result = await this.generateContentOrThrow([{ role: 'user', parts: [{ text: systemPrompt }] }], apiKey);
    await this.actionsService.logUsage(user, 'help-assistant', result.usage);

    const text = result.message.parts.find((p) => p.text !== undefined)?.text;
    return { answer: text ?? '(порожня відповідь)' };
  }

  async askAboutCustomerOrder(user: RequestUser, customerOrderId: string, question: string) {
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const order = await this.customerOrdersService.findOne(user, customerOrderId);
    const items = order.items as any[];

    const itemLines: string[] = [];
    let totalCostLocal = 0;
    for (const item of items) {
      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: item.assemblyId } });
      let productionOrderStatus = 'не створено';
      let lineTotalLocal: number | undefined;
      if (item.productionOrderId) {
        const po = await this.prisma.tenant.productionOrder.findUnique({ where: { id: item.productionOrderId } });
        if (po) {
          productionOrderStatus = po.status;
          if (po.totalLocalCostEur != null) lineTotalLocal = Number(po.totalLocalCostEur);
        }
      }
      if (lineTotalLocal === undefined && assembly) {
        try {
          const cost = await this.assembliesService.calculateCost(user, assembly.id);
          lineTotalLocal = cost.costPerUnit * Number(item.qty);
        } catch {
          lineTotalLocal = undefined;
        }
      }
      if (lineTotalLocal !== undefined) totalCostLocal += lineTotalLocal;
      itemLines.push(
        `- ${assembly?.name ?? item.assemblyId}: ${Number(item.qty)} шт, статус виробництва: ${productionOrderStatus}` +
          (lineTotalLocal != null ? `, оціночна вартість: ${lineTotalLocal} €` : ''),
      );
    }

    const context =
      'Дані замовлення клієнта в системі SH ERP:\n' +
      `Клієнт: ${order.clientName}${order.orderNumber ? ', № ' + order.orderNumber : ''}\n` +
      `Статус: ${order.status}\n` +
      `Дедлайн: ${order.deadline || 'не вказано'}, пріоритет: ${order.priority}\n` +
      (order.comment ? `Коментар: ${order.comment}\n` : '') +
      'Позиції:\n' +
      itemLines.join('\n') +
      `\nЗагальна оціночна вартість: ${totalCostLocal} €`;

    const systemPrompt =
      'Ти — асистент системи складського обліку й виробництва "SH ERP", який допомагає з КОНКРЕТНИМ замовленням клієнта. ' +
      'Відповідай українською мовою, по суті, спираючись на дані нижче. ' +
      'Якщо просять скласти лист, звіт чи документ — просто напиши повний текст цього документа, без зайвих коментарів навколо. ' +
      'Якщо запитують щось, чого немає в даних нижче — чесно скажи, що такої інформації не маєш.\n\n' +
      context +
      '\n\n=== ЗАПИТАННЯ ===\n' +
      question;

    const result = await this.generateContentOrThrow([{ role: 'user', parts: [{ text: systemPrompt }] }], apiKey);
    await this.actionsService.logUsage(user, 'customer-order-assistant', result.usage);

    const text = result.message.parts.find((p) => p.text !== undefined)?.text;
    return { answer: text ?? '(порожня відповідь)' };
  }

  /**
   * The full function-calling assistant (`askFullAssistant`,
   * AI_FullAssistant.gs). Loops model → tool-call → tool-result up to
   * `MAX_TOOL_LOOP_ITERATIONS` times, same cap as the legacy version. If any
   * tool call in a turn needs confirmation, stops immediately and returns a
   * durable `pendingActionId` rather than continuing the loop — mirroring
   * the legacy early-return on `needs_confirmation`, but with the
   * confirmation now persisted (`AiActionsService.proposeAction`) instead
   * of living only in the returned `history` blob.
   */
  async askFullAssistant(user: RequestUser, dto: AskFullAssistantDto) {
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const permissions = await loadPermissionSet(this.prisma, user);
    const toolContext = { user, permissions };
    const toolDeclarations = this.toolsRegistry.getDeclarations();

    const systemText =
      'Ти — повноцінний AI-асистент системи складського обліку й виробництва "SH ERP". Ти вмієш: ' +
      'відповідати на питання про систему; знаходити товари й виробничі замовлення; аналізувати виробництво; ' +
      'будувати звіти; прогнозувати нестачу матеріалів; знаходити причини простоїв виробництва; ' +
      'відповідати на будь-які питання щодо даних системи. ' +
      'У тебе є інструменти для отримання РЕАЛЬНИХ даних — використовуй їх щоразу, коли потрібні конкретні дані, не вигадуй нічого сам. ' +
      'Деякі інструменти є КРИТИЧНИМИ діями (зміна залишків тощо) — вони НІКОЛИ не виконуються одразу, система сама покаже користувачу підтвердження; ти просто повідомляєш, що саме пропонуєш зробити. ' +
      "Якщо користувач прикріпив зображення чи документ — уважно проаналізуй його вміст і дай корисну відповідь по суті. " +
      'Відповідай українською мовою, по суті, стисло. Коли створюєш файл — обов\'язково згадай посилання на нього.';

    let contents: AiMessage[] = [];
    if (dto.historyJson) {
      try {
        contents = JSON.parse(dto.historyJson);
      } catch {
        contents = [];
      }
    }

    const userParts: AiMessage['parts'] = [{ text: (contents.length ? '' : systemText + '\n\n') + dto.question }];
    if (dto.fileBase64 && dto.fileMimeType) {
      userParts.push({ inlineData: { mimeType: dto.fileMimeType, data: dto.fileBase64 } });
    }
    contents.push({ role: 'user', parts: userParts });

    let totalTokens = 0;

    for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
      const result = await this.generateContentOrThrow(contents, apiKey, toolDeclarations);
      if (result.usage?.totalTokens) totalTokens += result.usage.totalTokens;
      contents.push(result.message);

      const functionCalls = result.message.parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) {
        await this.actionsService.logUsage(user, 'full-assistant', { totalTokens });
        const text = result.message.parts.find((p) => p.text !== undefined)?.text;
        return { answer: text ?? '(порожня відповідь)', history: JSON.stringify(contents) };
      }

      const responseParts: AiMessage['parts'] = [];
      let pending: { action: string; args: Record<string, any>; description: string } | undefined;

      for (const fc of functionCalls) {
        const call = fc.functionCall!;
        const execResult = await this.toolsRegistry.executeTool(call.name, call.args || {}, toolContext);
        responseParts.push({ functionResponse: { name: call.name, response: execResult.result } });
        if (execResult.needsConfirmation && execResult.pendingAction && !pending) {
          pending = execResult.pendingAction;
        }
      }

      if (pending) {
        // Gemini requires role: 'user' for a functionResponse turn (role
        // 'function' is no longer accepted) — same fix documented in the
        // legacy AI_FullAssistant.gs header comment for this exact error.
        contents.push({ role: 'user', parts: responseParts });
        const pendingAction = await this.actionsService.proposeAction(user, pending.action, pending.args, pending.description);
        await this.actionsService.logUsage(user, 'full-assistant', { totalTokens });
        return {
          answer: `⚠️ Ця дія потребує підтвердження: ${pending.description}`,
          pendingConfirmation: { pendingActionId: pendingAction.id, action: pending.action, args: pending.args, description: pending.description },
          history: JSON.stringify(contents),
        };
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    await this.actionsService.logUsage(user, 'full-assistant', { totalTokens });
    throw new BadRequestException('Забагато кроків для відповіді — спробуйте перефразувати запитання простіше.');
  }

  async confirmAction(user: RequestUser, pendingActionId: string) {
    return this.actionsService.confirmAction(user, pendingActionId);
  }

  async cancelAction(user: RequestUser, pendingActionId: string) {
    return this.actionsService.cancelAction(user, pendingActionId);
  }

  /**
   * Ported from `recognizeInvoiceWithAI` (Gemini.gs): photo/scan → structured
   * line items, fuzzy-matched against existing Products by name.
   */
  async recognizeInvoice(user: RequestUser, base64Image: string, mimeType: string) {
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const prompt =
      'Ти аналізуєш фото або скан накладної від постачальника складу. ' +
      'Витягни ВСІ товарні позиції з таблиці накладної. ' +
      'Поверни СУВОРО валідний JSON-масив, без жодного тексту до чи після нього, без markdown-огортання. ' +
      'Формат кожного елемента: {"name": "точна назва товару як у накладній", "qty": число}. ' +
      'Якщо кількість не вдається розпізнати — став 1. Накладна може бути українською, англійською або німецькою мовою.';

    const result = await this.generateContentOrThrow(
      [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      apiKey,
    );
    await this.actionsService.logUsage(user, 'invoice-ocr', result.usage);

    const text = result.message.parts.find((p) => p.text !== undefined)?.text ?? '';
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let items: any[];
    try {
      items = JSON.parse(cleaned);
    } catch {
      throw new BadRequestException('AI did not return valid JSON for the recognized invoice.');
    }
    if (!Array.isArray(items)) throw new BadRequestException('AI returned something other than a list of line items.');

    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });

    return items.map((item) => {
      const rawName = String(item.name || '').trim();
      const rawLower = rawName.toLowerCase();
      let match = products.find((p) => p.name.toLowerCase() === rawLower);
      if (!match) {
        match = products.find(
          (p) => rawLower.length > 3 && (p.name.toLowerCase().includes(rawLower) || rawLower.includes(p.name.toLowerCase())),
        );
      }
      return {
        rawName,
        qty: Number(item.qty) || 1,
        matched: !!match,
        article: match ? match.article : '',
        matchedName: match ? match.name : '',
      };
    });
  }

  /**
   * `AiProviderException` (invalid key, quota exhausted, Gemini overloaded,
   * etc.) already carries a clear Ukrainian message — but if it escapes
   * uncaught, Nest's default filter turns it into a generic 500 "Internal
   * server error" for the frontend. Every call site must go through this so
   * the real reason reaches the user instead of being swallowed.
   */
  private async generateContentOrThrow(contents: AiMessage[], apiKey: string, tools?: AiToolDeclaration[]): Promise<AiGenerateResult> {
    try {
      return await this.provider.generateContent(contents, apiKey, tools);
    } catch (e) {
      if (e instanceof AiProviderException) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
