import { Injectable, Logger } from '@nestjs/common';
import { AiContentPart, AiGenerateResult, AiMessage, AiProviderException, AiProviderPort, AiToolDeclaration } from './ai-provider.port';

/**
 * DeepSeek-V3/R1 (2026-09-06, user request: "щоб на вибір була або вона або
 * gemini") — an OpenAI-compatible chat-completions API
 * (https://api.deepseek.com/chat/completions), model 'deepseek-chat' (V3)
 * by default; `deepseek-reasoner` (R1) is available via AI_DEEPSEEK_MODEL
 * for whoever wants the reasoning model's slower/pricier tradeoff instead.
 *
 * Function calling (2026-09-06, follow-up): DeepSeek's API supports OpenAI-
 * shaped `tools`/`tool_calls`, so `askFullAssistant` now works on this
 * provider too — `toOpenAiMessages`/`fromOpenAiMessage` below translate
 * between the port's Gemini-shaped `AiMessage[]` (the ONE format
 * `AiService`'s tool loop and `PendingAiAction.historyJson` persist,
 * regardless of which provider produced/will consume it) and DeepSeek's
 * flat `{role, content, tool_calls}` messages, synthesizing OpenAI's
 * required `tool_call_id` (Gemini has no id concept — functionCall/
 * functionResponse pair up by position instead) deterministically per
 * conversion.
 *
 * Still Gemini-only: `recognizeInvoice` (needs image vision — a genuine
 * DeepSeek-V3/R1 model limitation, not a scoping choice) always routes to
 * GeminiAdapter regardless of the company's chosen provider; see
 * AiService's own header comment.
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

    const payload: Record<string, any> = { model: this.model, messages: toOpenAiMessages(contents), stream: false };
    if (tools && tools.length > 0) {
      payload.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }

    const json = await this.fetchWithRetry(payload, apiKey);

    const message = json?.choices?.[0]?.message;
    const hasText = typeof message?.content === 'string' && message.content.length > 0;
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    if (!message || (!hasText && !hasToolCalls)) {
      throw new AiProviderException('DeepSeek не повернув відповідь.');
    }

    const usage = json?.usage;
    return {
      message: fromOpenAiMessage(message),
      usage: usage
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }
        : undefined,
    };
  }

  private async fetchWithRetry(payload: Record<string, any>, apiKey: string): Promise<any> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
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

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/**
 * Gemini-shaped `AiMessage[]` → DeepSeek's flat OpenAI-style messages.
 * `AiService#askFullAssistant`'s loop always shapes the history the same
 * way — an assistant/'model' turn with `functionCall` parts is immediately
 * followed by exactly one 'user' turn whose parts are the matching
 * `functionResponse`s, in the same order (see that method's own comment on
 * why: Gemini pairs call↔response positionally, no id). `pendingCallIds`
 * carries the synthetic ids assigned to the most recent assistant turn's
 * tool_calls forward to that next turn, so each `functionResponse` becomes
 * a `tool` message with the matching `tool_call_id` OpenAI's protocol
 * requires. Re-derived fresh on every call (ids aren't persisted anywhere),
 * which is fine — only internal consistency within one converted array
 * matters, not stability across separate requests.
 */
function toOpenAiMessages(contents: AiMessage[]): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [];
  let callCounter = 0;
  let pendingCallIds: string[] = [];

  for (const msg of contents) {
    const functionCallParts = msg.parts.filter((p): p is AiContentPart & { functionCall: NonNullable<AiContentPart['functionCall']> } => !!p.functionCall);
    const functionResponseParts = msg.parts.filter(
      (p): p is AiContentPart & { functionResponse: NonNullable<AiContentPart['functionResponse']> } => !!p.functionResponse,
    );
    const text = msg.parts
      .map((p) => p.text)
      .filter((t): t is string => t !== undefined)
      .join('\n');

    if (functionResponseParts.length > 0) {
      functionResponseParts.forEach((p, i) => {
        const id = pendingCallIds[i] ?? `call_${callCounter++}`;
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(p.functionResponse.response ?? null) });
      });
      pendingCallIds = [];
      continue;
    }

    if (functionCallParts.length > 0) {
      const toolCalls: OpenAiToolCall[] = functionCallParts.map((p) => ({
        id: `call_${callCounter++}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
      }));
      pendingCallIds = toolCalls.map((c) => c.id);
      messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
      continue;
    }

    messages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: text });
  }
  return messages;
}

/** DeepSeek's reply → Gemini-shaped `AiMessage`, the ONE format the rest of AiService understands regardless of provider. */
function fromOpenAiMessage(message: any): AiMessage {
  const parts: AiContentPart[] = [];
  if (typeof message.content === 'string' && message.content.length > 0) {
    parts.push({ text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: call.function?.name, args } });
    }
  }
  return { role: 'model', parts };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
