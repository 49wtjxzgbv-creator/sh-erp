import { Injectable, Logger } from '@nestjs/common';
import {
  AiContentPart,
  AiGenerateResult,
  AiMessage,
  AiProviderException,
  AiProviderPort,
  AiToolDeclaration,
} from './ai-provider.port';

/**
 * Ported from `Gemini.gs`'s `fetchGeminiJson_` / `callGemini_` /
 * `callGeminiWithTools_`. Preserves the two behaviors the legacy header
 * comment specifically calls out as hard-won:
 *  1. Model reference is an **alias** (`gemini-flash-latest` by default,
 *     overridable via `AI_MODEL_ALIAS`), never a pinned dated version —
 *     pinned versions have gone stale/unavailable multiple times in this
 *     project's history (Phase 1 §3.7/§10.12).
 *  2. Exactly one retry on a quota/429 error, waiting for Google's own
 *     suggested `retryDelay` if present (else a 5s default), capped at 55s.
 *     The legacy 55s cap existed to stay inside Apps Script's execution
 *     limit; kept here for parity even though a Node process has no such
 *     hard ceiling — there's no reason to wait longer than that for a
 *     synchronous user-facing chat request either way.
 */
@Injectable()
export class GeminiAdapter implements AiProviderPort {
  private readonly logger = new Logger(GeminiAdapter.name);

  private get modelAlias(): string {
    return process.env.AI_MODEL_ALIAS || 'gemini-flash-latest';
  }

  async generateContent(contents: AiMessage[], apiKey: string, tools?: AiToolDeclaration[]): Promise<AiGenerateResult> {
    if (!apiKey) {
      throw new AiProviderException('Gemini API ключ не налаштовано. Додайте його в Налаштування → AI.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelAlias}:generateContent?key=${apiKey}`;
    const payload: Record<string, any> = { contents: contents.map(toWireMessage) };
    if (tools && tools.length > 0) {
      payload.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }

    const json = await this.fetchWithQuotaRetry(url, payload);

    const candidate = json?.candidates?.[0];
    if (!candidate) {
      throw new AiProviderException('Gemini не повернув відповідь (можливо, заблоковано фільтром безпеки).');
    }

    const usageMetadata = json?.usageMetadata;

    return {
      message: fromWireMessage(candidate.content),
      usage: usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount,
            completionTokens: usageMetadata.candidatesTokenCount,
            totalTokens: usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  private async fetchWithQuotaRetry(url: string, payload: Record<string, any>): Promise<any> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const httpCode = response.status;
      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      const errMessage = json?.error?.message || text;
      const hasError = httpCode >= 400 || (json && json.error);

      if (hasError) {
        const isQuota =
          httpCode === 429 ||
          json?.error?.status === 'RESOURCE_EXHAUSTED' ||
          Number(json?.error?.code) === 429 ||
          /quota|rate.?limit/i.test(errMessage);

        // Google's own model-overload message ("This model is currently
        // experiencing high demand") comes back as a 503 UNAVAILABLE — a
        // transient, Google-side condition distinct from quota exhaustion,
        // but just as worth retrying. No structured retryDelay is provided
        // for it (unlike quota errors), so a short fixed backoff is used.
        const isOverloaded =
          httpCode === 503 ||
          json?.error?.status === 'UNAVAILABLE' ||
          Number(json?.error?.code) === 503 ||
          /overloaded|high demand/i.test(errMessage);

        if ((isQuota || isOverloaded) && attempt < maxAttempts) {
          const delayMs = isQuota ? Math.min(this.retryDelayMs(json?.error) ?? 5000, 55000) : Math.min(3000 * attempt, 15000);
          this.logger.warn(
            `Gemini ${isQuota ? 'quota/429' : 'overloaded/503'} — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`,
          );
          await sleep(delayMs);
          continue;
        }
        if (isQuota) {
          throw new AiProviderException(
            'Вичерпано ліміт запитів Gemini. Зачекайте хвилину-дві й спробуйте ще раз, або перевірте тариф/Billing для цього API-ключа в Google Cloud Console. ' +
              `Деталі від Google: ${errMessage}`,
          );
        }
        if (isOverloaded) {
          throw new AiProviderException('Gemini зараз перевантажено запитами від усіх користувачів Google. Спробуйте ще раз за хвилину.');
        }
        throw new AiProviderException(`Gemini: ${errMessage}`);
      }

      if (!json) throw new AiProviderException('Gemini повернув невалідну відповідь.');
      return json;
    }
    // Unreachable — the loop always either returns or throws.
    throw new AiProviderException('Gemini: unexpected retry-loop exit.');
  }

  private retryDelayMs(error: any): number | null {
    try {
      const details = error?.details || [];
      for (const detail of details) {
        if (detail.retryDelay) {
          const sec = parseFloat(String(detail.retryDelay).replace('s', ''));
          if (!isNaN(sec)) return Math.ceil(sec * 1000) + 500; // +500ms buffer
        }
      }
    } catch {
      // fall through to null
    }
    return null;
  }
}

function toWireMessage(message: AiMessage): Record<string, any> {
  return { role: message.role, parts: message.parts.map(toWirePart) };
}

function toWirePart(part: AiContentPart): Record<string, any> {
  if (part.text !== undefined) return { text: part.text };
  if (part.inlineData) return { inline_data: { mime_type: part.inlineData.mimeType, data: part.inlineData.data } };
  if (part.functionCall) {
    const wire: Record<string, any> = { functionCall: part.functionCall };
    if (part.thoughtSignature) wire.thoughtSignature = part.thoughtSignature;
    return wire;
  }
  if (part.functionResponse) return { functionResponse: part.functionResponse };
  return {};
}

function fromWireMessage(content: any): AiMessage {
  const parts: AiContentPart[] = (content?.parts || []).map((p: any) => {
    if (p.text !== undefined) return { text: p.text };
    if (p.functionCall) {
      const part: AiContentPart = { functionCall: { name: p.functionCall.name, args: p.functionCall.args || {} } };
      if (p.thoughtSignature) part.thoughtSignature = p.thoughtSignature;
      return part;
    }
    if (p.inline_data) return { inlineData: { mimeType: p.inline_data.mime_type, data: p.inline_data.data } };
    return {};
  });
  return { role: 'model', parts };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
