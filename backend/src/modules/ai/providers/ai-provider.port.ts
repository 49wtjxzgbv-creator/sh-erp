/**
 * Provider-abstracted AI port (Phase 2 §8): the rest of the AI module talks
 * to this interface, never to a concrete vendor SDK. `GeminiAdapter` is the
 * first implementation, ported from `Gemini.gs`'s `fetchGeminiJson_`, but
 * nothing outside `gemini.adapter.ts` knows Gemini exists — swapping vendors
 * later is purely additive (a new adapter + a provider binding change).
 */

export interface AiInlineData {
  mimeType: string;
  data: string; // base64
}

export interface AiContentPart {
  text?: string;
  inlineData?: AiInlineData;
  functionCall?: { name: string; args: Record<string, any> };
  functionResponse?: { name: string; response: any };
  /**
   * Gemini "thinking" models attach this to functionCall parts and require
   * it echoed back verbatim on the next turn — dropping it degrades tool
   * calling and triggers "Function call is missing a thought_signature"
   * (https://ai.google.dev/gemini-api/docs/thought-signatures). Opaque to
   * us; just round-trip it.
   */
  thoughtSignature?: string;
}

/**
 * `role` is intentionally just `'user' | 'model'` — Gemini's own API no
 * longer accepts a distinct `'function'` role for tool results (see the
 * legacy `AI_FullAssistant.gs` header comment on this exact point: a
 * function response must be sent back as `role: 'user'`). Keeping the
 * port's role enum this narrow avoids reintroducing that bug in a future
 * adapter.
 */
export interface AiMessage {
  role: 'user' | 'model';
  parts: AiContentPart[];
}

export interface AiToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON-schema-shaped, passed through to the provider largely as-is
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiGenerateResult {
  message: AiMessage;
  usage?: AiUsage;
}

export const AI_PROVIDER_PORT = 'AI_PROVIDER_PORT';

export interface AiProviderPort {
  /**
   * `apiKey` is passed per-call (not read from provider-internal config)
   * because a company may bring its own key (`CompanyAiSettings.apiKeyEncrypted`)
   * instead of using the platform-provided one — see `AiSettingsService`.
   */
  generateContent(contents: AiMessage[], apiKey: string, tools?: AiToolDeclaration[]): Promise<AiGenerateResult>;
}

/** Raised for any provider-level failure (quota, safety block, network, bad key) — callers map this to a user-facing message, never leak the raw provider error text unfiltered. */
export class AiProviderException extends Error {}
