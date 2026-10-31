import { Injectable, Logger } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { CustomerOrdersService } from '../sales/customer-orders.service';
import { FilesService } from '../files/files.service';
import { HELP_MANUAL_TEXT } from './help-manual.constant';
import { AiGenerateResult, AiMessage, AiProviderException, AiProviderPort, AiToolDeclaration } from './providers/ai-provider.port';
import { GeminiAdapter } from './providers/gemini.adapter';
import { DeepSeekAdapter } from './providers/deepseek.adapter';
import { AiActionsService } from './ai-actions.service';
import { AiSettingsService } from './ai-settings.service';
import { AiToolsRegistry } from './tools/tools.registry';
import { loadPermissionSet } from '../../common/authorization/permission-set.util';
import { AskFullAssistantDto } from './dto/ask-full-assistant.dto';
import { MatchedBomLine, toMatchedBomLine } from './match-products.util';

const MAX_TOOL_LOOP_ITERATIONS = 6; // mirrors the legacy askFullAssistant's maxIterations

/**
 * Top-level AI orchestration (Phase 2 §8 / Phase 1 §3.7). Three entry
 * points, ported 1:1 from Gemini.gs / AI_FullAssistant.gs:
 *  - `askHelp`: the "Довідник" — instruction-only, zero live-data access.
 *  - `askFullAssistant`: the function-calling assistant over `AiToolsRegistry`'s
 *    tool catalogue, with the critical-action confirmation hand-off.
 *  - `askAboutCustomerOrder`: narrowly-scoped Q&A over one specific order's
 *    real data.
 *
 * Provider routing (2026-09-06, DeepSeek support + function-calling
 * follow-up): every method except `recognizeInvoice` goes through
 * `resolveProvider()`, honoring the company's own `CompanyAiSettings.
 * provider` choice — including `askFullAssistant` now that DeepSeekAdapter
 * translates Gemini's functionCall/functionResponse shape to/from
 * DeepSeek's OpenAI-style tool_calls (see that adapter's header comment).
 * `recognizeInvoice` ALWAYS uses `GeminiAdapter` directly regardless of
 * that setting — it needs image vision, a genuine DeepSeek-V3/R1 model
 * limitation, not a scoping choice, so routing it through the company's
 * pick would silently break it the moment someone selected DeepSeek.
 */

/** Same 4-locale set the app ships messages for (frontend/lib/i18n-locales.ts) — Ukrainian names, spelled out in `translateJson`'s own prompt because a bare ISO code wasn't reliably honored by every provider (see that method's own comment). */
const LOCALE_NAMES: Record<string, string> = {
  uk: 'українську',
  en: 'англійську',
  de: 'німецьку',
  pl: 'польську',
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly geminiProvider: GeminiAdapter,
    private readonly deepSeekProvider: DeepSeekAdapter,
    private readonly prisma: PrismaService,
    private readonly settingsService: AiSettingsService,
    private readonly actionsService: AiActionsService,
    private readonly toolsRegistry: AiToolsRegistry,
    private readonly assembliesService: AssembliesService,
    private readonly customerOrdersService: CustomerOrdersService,
    private readonly filesService: FilesService,
  ) {}

  private async resolveProvider(companyId: string): Promise<AiProviderPort> {
    const provider = await this.settingsService.getProvider(companyId);
    return provider === 'deepseek' ? this.deepSeekProvider : this.geminiProvider;
  }

  /**
   * "Хто ми / чим займаємось" (2026-09-06 user request) — the company's own
   * CompanyAiSettings.contextText, if set, formatted as its own section so
   * the model can't confuse it with the instruction/order-data sections
   * around it. Returns '' (not injected at all) when unset, so a company
   * that never fills this in sees byte-for-byte the same prompt as before
   * this feature existed. Deliberately NOT added to translateJson
   * (mechanical field-by-field translation, no use for business context)
   * or recognizeInvoice (structured extraction from an image, same
   * reasoning).
   */
  private async companyContextBlock(companyId: string): Promise<string> {
    const contextText = await this.settingsService.getContextText(companyId);
    if (!contextText) return '';
    return `\n\n=== ПРО КОМПАНІЮ ===\n${contextText}`;
  }

  async askHelp(user: RequestUser, question: string) {
    const provider = await this.resolveProvider(user.companyId);
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const systemPrompt =
      'Ти — довідковий асистент системи "SH ERP" (склад і виробництво). ' +
      'Відповідай КОРОТКО, українською мовою, спираючись ВИКЛЮЧНО на інструкцію нижче. ' +
      'Не вигадуй кнопок, розділів чи функцій, яких немає в інструкції. ' +
      'Якщо відповіді в інструкції немає — чесно скажи, що не маєш такої інформації, і порадь звернутись до адміністратора. ' +
      'Не обговорюй нічого, що не стосується роботи із застосунком.' +
      (await this.companyContextBlock(user.companyId)) +
      '\n\n=== ІНСТРУКЦІЯ ===\n' +
      HELP_MANUAL_TEXT +
      '\n\n=== ЗАПИТАННЯ КОРИСТУВАЧА ===\n' +
      question;

    const result = await this.generateContentOrThrow(provider, [{ role: 'user', parts: [{ text: systemPrompt }] }], apiKey);
    await this.actionsService.logUsage(user, 'help-assistant', result.usage);

    const text = result.message.parts.find((p) => p.text !== undefined)?.text;
    return { answer: text ?? '(порожня відповідь)' };
  }

  async askAboutCustomerOrder(user: RequestUser, customerOrderId: string, question: string) {
    const provider = await this.resolveProvider(user.companyId);
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const order = await this.customerOrdersService.findOne(user, customerOrderId);
    const items = order.items as any[];

    const itemLines: string[] = [];
    let totalCostLocal = 0;
    for (const item of items) {
      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: item.assemblyId } });
      // A line can have multiple production batches (План-графік §1,
      // batch-splitting) — summarize across all of them rather than a
      // single 1:1 order, which the old CustomerOrderItem.productionOrderId
      // link could never represent once splitting shipped.
      const batches = await this.prisma.tenant.productionOrder.findMany({ where: { customerOrderItemId: item.id } });
      let productionOrderStatus = 'не створено';
      let lineTotalLocal: number | undefined;
      if (batches.length === 1) {
        productionOrderStatus = batches[0].status;
      } else if (batches.length > 1) {
        const byStatus = new Map<string, number>();
        for (const b of batches) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
        productionOrderStatus = Array.from(byStatus.entries()).map(([status, count]) => `${status} (${count})`).join(', ');
      }
      const batchCosts = batches.map((b) => b.totalLocalCostEur).filter((c): c is NonNullable<typeof c> => c != null);
      if (batchCosts.length > 0) lineTotalLocal = batchCosts.reduce((sum, c) => sum + Number(c), 0);
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
      'Якщо запитують щось, чого немає в даних нижче — чесно скажи, що такої інформації не маєш.' +
      (await this.companyContextBlock(user.companyId)) +
      '\n\n' +
      context +
      '\n\n=== ЗАПИТАННЯ ===\n' +
      question;

    const result = await this.generateContentOrThrow(provider, [{ role: 'user', parts: [{ text: systemPrompt }] }], apiKey);
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
    const provider = await this.resolveProvider(user.companyId);
    // DeepSeek has no vision — an attached image/document would silently
    // go unseen if sent anyway (toOpenAiMessages drops inlineData parts).
    // Fail loudly instead of quietly answering as if nothing was attached.
    if (provider === this.deepSeekProvider && dto.fileBase64) {
      throw new CodedBadRequestException(
        'AI_DEEPSEEK_NO_ATTACHMENTS',
        'DeepSeek не підтримує зображення чи документи в цьому запиті — приберіть вкладення або оберіть Gemini в Налаштування → AI.',
      );
    }
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
      'Відповідай українською мовою, по суті, стисло. Коли створюєш файл — обов\'язково згадай посилання на нього.' +
      (await this.companyContextBlock(user.companyId));

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
      const result = await this.generateContentOrThrow(provider, contents, apiKey, toolDeclarations);
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
    throw new CodedBadRequestException('AI_TOO_MANY_STEPS', 'Забагато кроків для відповіді — спробуйте перефразувати запитання простіше.');
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
    // Always Gemini — this needs image vision, which DeepSeekAdapter
    // doesn't support (see this class's own header comment).
    const apiKey = await this.settingsService.getGeminiApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const prompt =
      'Ти аналізуєш фото або скан накладної від постачальника складу. ' +
      'Витягни ВСІ товарні позиції з таблиці накладної. ' +
      'Поверни СУВОРО валідний JSON-масив, без жодного тексту до чи після нього, без markdown-огортання. ' +
      'Формат кожного елемента: {"name": "точна назва товару як у накладній", "qty": число}. ' +
      'Якщо кількість не вдається розпізнати — став 1. Накладна може бути українською, англійською або німецькою мовою.';

    const result = await this.generateContentOrThrow(
      this.geminiProvider,
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
      throw new CodedBadRequestException('AI_INVOICE_INVALID_JSON', 'AI did not return valid JSON for the recognized invoice.');
    }
    if (!Array.isArray(items)) throw new CodedBadRequestException('AI_INVOICE_NOT_A_LIST', 'AI returned something other than a list of line items.');

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
        productId: match ? match.id : '',
      };
    });
  }

  /**
   * "Креслення → специфікація" (2026-10-31): a PDF/scanned technical
   * drawing's title-block parts table → a draft BOM, fuzzy-matched against
   * existing Products — same idea as `recognizeInvoice` above, but fixed
   * transport. `recognizeInvoice` takes the file as inline base64 in the
   * JSON request body, which silently hits Express/body-parser's default
   * 100KB limit (no override exists anywhere in this app) long before
   * anything resembling a real drawing PDF would fit. This instead takes a
   * `fileAssetId` for a file already uploaded through the normal presigned-
   * upload flow (`FilesModule`, 200MB ceiling, never transits this app's
   * own request body) and fetches the bytes server-side via
   * `FilesService.getFileAssetBytes` — built exactly for "a server-side
   * consumer needs the real bytes in-process" (already used by
   * SupplierRequestDocumentsPdfService). The uploaded drawing also stays a
   * real `FileAsset` afterward, unlike `recognizeInvoice`'s image, which is
   * discarded the moment the request completes.
   */
  async extractBomFromDrawing(user: RequestUser, fileAssetId: string): Promise<{ sourceFileAssetId: string; lines: MatchedBomLine[] }> {
    const apiKey = await this.settingsService.getGeminiApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const { bytes, mimeType } = await this.filesService.getFileAssetBytes(user, fileAssetId);

    const prompt =
      'Ти аналізуєш технічне креслення (PDF або скан) виробничого виробу. ' +
      'Знайди таблицю специфікації/переліку деталей (BOM) на кресленні — зазвичай у штампі або окремому блоці. ' +
      'Витягни ВСІ позиції з цієї таблиці. ' +
      'Поверни СУВОРО валідний JSON-масив, без жодного тексту до чи після нього, без markdown-огортання. ' +
      'Формат кожного елемента: {"name": "точна назва/позначення деталі як на кресленні", "qty": число, "dimensions": "розміри як вказано на кресленні, або null якщо не вказано"}. ' +
      'Якщо кількість не вдається розпізнати — став 1. Креслення може бути українською, англійською або німецькою мовою.';

    const result = await this.generateContentOrThrow(
      this.geminiProvider,
      [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: bytes.toString('base64') } }] }],
      apiKey,
    );
    // Real incident, 2026-10-31: an unusually slow/overloaded Gemini call
    // (GeminiAdapter's own retry/backoff can push total latency well past
    // a minute) outlived the ambient per-request Prisma transaction
    // (TenantScopeInterceptor's own 60s cap — see the standing "prisma.tenant
    // has no $transaction in-request" gotcha) — logUsage's own write then
    // hit "Transaction already closed" and threw, discarding an extraction
    // that had ALREADY succeeded. Usage logging is bookkeeping, not the
    // actual result the user is waiting on; failing to log it is a real
    // gap (quota tracking under-counts this call) but a far smaller one
    // than silently throwing away a successful AI result the company's
    // quota already paid for.
    try {
      await this.actionsService.logUsage(user, 'bom-extraction-drawing', result.usage);
    } catch (err) {
      this.logger.warn(`extractBomFromDrawing: logUsage failed (result still returned to caller): ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = result.message.parts.find((p) => p.text !== undefined)?.text ?? '';
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let items: any[];
    try {
      items = JSON.parse(cleaned);
    } catch {
      throw new CodedBadRequestException('AI_BOM_EXTRACTION_INVALID_JSON', 'AI did not return valid JSON for the extracted BOM.');
    }
    if (!Array.isArray(items)) {
      throw new CodedBadRequestException('AI_BOM_EXTRACTION_NOT_A_LIST', 'AI returned something other than a list of BOM lines.');
    }

    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });
    const lines = items.map((item) =>
      toMatchedBomLine(String(item.name || '').trim(), Number(item.qty) || 1, item.dimensions ? String(item.dimensions).trim() : null, products),
    );

    return { sourceFileAssetId: fileAssetId, lines };
  }

  /**
   * Generic "translate this batch of free text" helper (2026-09-06,
   * Quotations language switcher; generalized 2026-10-29 for the Supplier
   * Requests language switcher — see AiController's own `translate-json`
   * endpoint) — a flat `{key: string|null}` object in, the same shape
   * translated back out. One request for every field on a document instead
   * of N (name/description/unit per item, plus terms/notes) — same "batch
   * it into one JSON round-trip" reasoning as `recognizeInvoice`. Null/empty
   * values are filtered out before the call (nothing to translate) and
   * re-inserted as-is afterward, so the caller never has to special-case
   * them. `documentKind`/`usageFeature` let each caller frame the AI prompt
   * and the usage-log entry accurately for ITS OWN document type, rather
   * than every caller's usage showing up mislabeled as a quotation.
   */
  async translateJson(
    user: RequestUser,
    fields: Record<string, string | null>,
    targetLocale: string,
    documentKind = 'комерційної пропозиції (умови оплати/доставки/монтажу, примітки, назви й описи товарних позицій)',
    usageFeature = 'quotation-translate',
  ): Promise<Record<string, string | null>> {
    const entries = Object.entries(fields).filter(([, v]) => v != null && v.trim() !== '') as [string, string][];
    if (entries.length === 0) return fields;

    const provider = await this.resolveProvider(user.companyId);
    const apiKey = await this.settingsService.getEffectiveApiKey(user.companyId);
    await this.actionsService.checkQuota(user);

    const input = Object.fromEntries(entries);
    // Real production bug report (2026-10-29, Supplier Requests language
    // switcher): picking de/pl came back English — every usage log showed
    // the real AI round-trip completing normally (not an error, not a
    // silently-skipped call), which points at the provider (DeepSeek, per
    // this company's own AiSettings) simply not honoring a bare ISO 639-1
    // code strongly enough. Naming the language explicitly, and repeating
    // the instruction right before the JSON payload (the position a model
    // weights most), is the standard mitigation for this class of
    // instruction-following failure.
    const localeName = LOCALE_NAMES[targetLocale] ?? targetLocale;
    const prompt =
      `Переклади значення цього JSON-об'єкта на ${localeName} мову (код ISO 639-1 "${targetLocale}"). ` +
      'Ключі залишай ТОЧНО такими самими, зміни лише значення. ' +
      `Це текст ${documentKind} — перекладай по-діловому, природно, без дослівщини. ` +
      'Якщо значення — власна назва, артикул чи не потребує перекладу, залиш його без змін. ' +
      `ВАЖЛИВО: результат ОБОВ'ЯЗКОВО має бути ${localeName} мовою — НЕ англійською і не будь-якою іншою, незалежно від мови вхідного тексту. ` +
      'Поверни СУВОРО валідний JSON-об\'єкт з тими самими ключами, без жодного тексту до чи після нього, без markdown-огортання.\n\n' +
      JSON.stringify(input);

    const result = await this.generateContentOrThrow(provider, [{ role: 'user', parts: [{ text: prompt }] }], apiKey);
    await this.actionsService.logUsage(user, usageFeature, result.usage);

    const text = result.message.parts.find((p) => p.text !== undefined)?.text ?? '';
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let translated: Record<string, string>;
    try {
      translated = JSON.parse(cleaned);
    } catch {
      throw new CodedBadRequestException('AI_TRANSLATION_INVALID_JSON', 'AI did not return valid JSON for the translated text.');
    }

    const merged: Record<string, string | null> = { ...fields };
    for (const key of Object.keys(input)) {
      merged[key] = typeof translated[key] === 'string' ? translated[key] : input[key];
    }
    return merged;
  }

  /**
   * `AiProviderException` (invalid key, quota exhausted, Gemini overloaded,
   * etc.) already carries a clear Ukrainian message — but if it escapes
   * uncaught, Nest's default filter turns it into a generic 500 "Internal
   * server error" for the frontend. Every call site must go through this so
   * the real reason reaches the user instead of being swallowed.
   */
  private async generateContentOrThrow(provider: AiProviderPort, contents: AiMessage[], apiKey: string, tools?: AiToolDeclaration[]): Promise<AiGenerateResult> {
    try {
      return await provider.generateContent(contents, apiKey, tools);
    } catch (e) {
      if (e instanceof AiProviderException) throw new CodedBadRequestException('AI_PROVIDER_ERROR', e.message);
      throw e;
    }
  }
}
