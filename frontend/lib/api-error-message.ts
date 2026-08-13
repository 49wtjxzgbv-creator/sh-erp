'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from './api-client/types';

/**
 * Resolves an API error to a string in the user's current interface
 * language. Backend exceptions thrown via the Coded* classes
 * (backend/src/common/api-exceptions.ts) carry a stable `code` — looked up
 * in the `apiErrors` message namespace (messages/*.json), translated per
 * locale. Anything without a matching translated code (not yet migrated to
 * a Coded* exception, or a class-validator-generated validation string,
 * which has no single stable code to translate against) falls back to the
 * raw `err.message` from the backend — still better than a generic
 * "something went wrong" catch-all, just not locale-aware.
 *
 * Usage: `const apiErrorMessage = useApiErrorMessage(); ...catch (err) { setError(apiErrorMessage(err, tc('error'))); }`
 */
export function useApiErrorMessage() {
  const t = useTranslations('apiErrors');
  return function apiErrorMessage(err: unknown, fallback: string): string {
    if (!(err instanceof ApiError)) return fallback;
    if (err.code && t.has(err.code)) return t(err.code);
    return err.message || fallback;
  };
}
