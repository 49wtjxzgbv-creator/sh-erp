import { Injectable, Logger } from '@nestjs/common';
import { AiGenerateResult, AiMessage, AiProviderException, AiProviderPort, AiToolDeclaration } from './ai-provider.port';

/**
 * DeepSeek-V3/R1 (2026-09-06, user request: "щоб на вибір була або вона або
 * gemini") — an OpenAI-compatible chat-completions API
 * (https://api.deepseek.com/chat/completions), model 'deepseek-chat' (V3)
 * by default; `deepseek-reasoner` (R1) is available via AI_DEEPSEEK_MODEL
 * for whoever wants the reasoning model's slower/pricier tradeoff instead.
 *
 * Deliberately narrower than GeminiAdapter, by explicit user decision
 * (2026-09-06, "спочатку лише прості функції" — start with the plain-text
 * ones only): this adapter only ever receives plain single-turn text calls
 * (AiService#askHelp, #askAboutCustomerOrder, #translateJson) — AiService
 * routes #recognizeInvoice (needs image vision, which DeepSeek-V3/R1 don't
 * support) and #askFullAssistant (needs function-calling, not implemented
 * here yet) to GeminiAdapter unconditionally, regardless of the company's
 * chosen provider. `tools` is accepted only to satisfy AiProviderPort's
 * shape; a non-empty value here would mean AiService's own routing has a
 * bug, so it fails loudly rather than silently ignoring the tools.
 */
@Injectable()
export class DeepSeekAdapter implements AiProviderPort {
  private readonly logger = new Logger(DeepSeekAdapter.name);

  private get apiBaseUrl(): string {
    return process.env.AI_DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com';
  }

  private get model(): string {
    return process.env.AI_DEEPSEEK_MODEL || 'deepseek-chat';
  }

  async generateContent(contents: AiMessage[], apiKey: string, tools?: AiToolDeclaration[]): Promise<AiGenerateResult> {
    if (!apiKey) {
      throw new AiProviderException('DeepSeek API ключ не налаштовано. Додайте його в Налаштування → AI.');
    }
    if (tools && tools.length > 0) {
      throw new AiProviderException('DeepSeek у цій системі поки не підтримує виклик інструментів (function calling) — оберіть Gemini для повного AI-асистента.');
    }

    const messages = contents.map(toWireMessage);
    const json = await this.fetchWithRetry(messages, apiKey);

    const choice = json?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string') {
      throw new AiProviderException('DeepSeek не повернув текстову відповідь.');
    }

    const usage = json?.usage;
    return {
      message: { role: 'model', parts: [{ text }] },
      usage: usage
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }
        : undefined,
    };
  }

  private async fetchWithRetry(messages: Array<{ role: string; content: string }>, apiKey: string): Promise<any> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: this.model, messages, stream: false }),
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
        // 429 rate-limit and 503 "server busy"/overloaded — same two
        // transient conditions GeminiAdapter retries, same reasoning: worth
        // one short backoff-and-retry before surfacing to the user.
        const isRateLimited = httpCode === 429 || /rate.?limit/i.test(errMessage);
        const isOverloaded = httpCode === 503 || /overloaded|busy|unavailable/i.test(errMessage);

        if ((isRateLimited || isOverloaded) && attempt < maxAttempts) {
          const delayMs = Math.min(3000 * attempt, 15000);
          this.logger.warn(`DeepSeek ${isRateLimited ? 'rate-limited/429' : 'overloaded/503'} — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
          await sleep(delayMs);
          continue;
        }
        if (httpCode === 401 || httpCode === 403) {
          throw new AiProviderException('DeepSeek відхилив API-ключ — перевірте його в Налаштування → AI.');
        }
        if (isRateLimited) {
          throw new AiProviderException(`Вичерпано ліміт запитів DeepSeek. Спробуйте ще раз за хвилину. Деталі: ${errMessage}`);
        }
        if (isOverloaded) {
          throw new AiProviderException('DeepSeek зараз перевантажено запитами. Спробуйте ще раз за хвилину.');
        }
        throw new AiProviderException(`DeepSeek: ${errMessage}`);
      }

      if (!json) throw new AiProviderException('DeepSeek повернув невалідну відповідь.');
      return json;
    }
    // Unreachable — the loop always either returns or throws.
    throw new AiProviderException('DeepSeek: unexpected retry-loop exit.');
  }
}

/**
 * DeepSeek's chat-completions API takes flat `{role, content}` messages
 * (OpenAI shape), not Gemini's `{role, parts}` — text-only content is
 * concatenated (AiService never sends more than one text part per message
 * to this adapter; see this file's header comment on why images/tool parts
 * never reach here at all).
 */
function toWireMessage(message: AiMessage): { role: string; content: string } {
  const text = message.parts
    .map((p) => p.text)
    .filter((t): t is string => t !== undefined)
    .join('\n');
  return { role: message.role === 'model' ? 'assistant' : 'user', content: text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
