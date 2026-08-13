/**
 * Shape of a NestJS `ValidationPipe`/`HttpException` error body, e.g.
 * `{ statusCode: 400, message: ['email must be an email'], error: 'Bad Request' }`
 * or `{ statusCode: 401, message: 'Invalid email or password.', error: 'Unauthorized' }`.
 * `message` is a single string for most thrown exceptions but an array for
 * class-validator whitelist failures — both are handled by ApiError below.
 * `code` is only present on exceptions the backend has migrated to
 * `backend/src/common/api-exceptions.ts`'s Coded* classes — see
 * `frontend/lib/api-error-message.ts` for how it's resolved to a translated
 * string, with a fallback to the raw (English) `message` for anything not
 * yet migrated, including class-validator's own generated strings, which
 * have no single stable code to translate against.
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  code?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;
  /** Machine-readable error code, if the backend exception was thrown via a Coded* class — see ApiErrorBody. */
  readonly code: string | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, fallbackMessage: string) {
    const message = Array.isArray(body?.message)
      ? body!.message.join(' ')
      : body?.message ?? fallbackMessage;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = body?.code;
  }
}

export interface ApiRequestOptions {
  /** Query params appended to the URL, undefined/null values are skipped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip attaching the Authorization header (for @Public() backend routes). */
  skipAuth?: boolean;
  /** Skip the automatic refresh-and-retry-once behavior on a 401. */
  skipRefreshRetry?: boolean;
  signal?: AbortSignal;
}
