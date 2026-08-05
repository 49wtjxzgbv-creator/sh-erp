/**
 * Shape of a NestJS `ValidationPipe`/`HttpException` error body, e.g.
 * `{ statusCode: 400, message: ['email must be an email'], error: 'Bad Request' }`
 * or `{ statusCode: 401, message: 'Invalid email or password.', error: 'Unauthorized' }`.
 * `message` is a single string for most thrown exceptions but an array for
 * class-validator whitelist failures — both are handled by ApiError below.
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, fallbackMessage: string) {
    const message = Array.isArray(body?.message)
      ? body!.message.join(' ')
      : body?.message ?? fallbackMessage;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
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
