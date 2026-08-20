import { useSessionStore } from './session-store';
import { ApiError, type ApiErrorBody } from '../api-client/types';
import { queryClient } from '@/app/providers';

/**
 * Client-side auth actions. These call our own same-origin app/api/auth/*
 * route handlers (never the backend directly) so the httpOnly refresh
 * cookie stays entirely server-side — see those routes' header comments
 * and frontend/README.md's "Auth flow" section for the full rationale.
 */

interface SessionResponse {
  accessToken: string;
  userId: string;
  companyId: string;
  companySlug: string;
  impersonatedBy?: string | null;
}

async function parseOrThrow(res: Response): Promise<SessionResponse> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
  }
  return data as SessionResponse;
}

/**
 * Real incident this fixes: nothing previously cleared TanStack Query's
 * cache across a login/logout inside the same browser tab, so switching
 * accounts (e.g. testing a lower-privilege role, then logging back in as
 * an admin) kept serving the PREVIOUS account's cached results under
 * identical query keys — including permission-gated data (photo URLs,
 * lists) that had 403'd/come back empty for the lower-privileged account
 * and stayed cached that way even after logging back into an account that
 * legitimately has access. `.clear()` (not `.invalidateQueries()`) drops
 * the data immediately rather than leaving stale data on screen while a
 * background refetch runs.
 */
export async function login(companySlug: string, email: string, password: string): Promise<SessionResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companySlug, email, password }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  queryClient.clear();
  useSessionStore.getState().setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    useSessionStore.getState().clearSession();
    queryClient.clear();
  }
}

/**
 * Called once on mount of the authenticated shell (and available for the
 * public shell too, to redirect an already-signed-in visitor away from
 * /login) to silently re-derive an access token from the httpOnly refresh
 * cookie — necessary because the access token itself lives only in memory
 * and does not survive a page reload or new tab. Also covers the
 * multi-tab version of the same-tab login/logout staleness fix above: if
 * another tab logged in as a different user (shared httpOnly cookie),
 * this tab's own cached query data is for the PREVIOUS account and must
 * be dropped too, not just the session identity fields.
 */
export async function restoreSession(): Promise<boolean> {
  const previousUserId = useSessionStore.getState().userId;
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      useSessionStore.getState().clearSession();
      queryClient.clear();
      return false;
    }
    const session = await parseOrThrow(res);
    if (previousUserId && previousUserId !== session.userId) queryClient.clear();
    useSessionStore.getState().setSession(session);
    return true;
  } catch {
    useSessionStore.getState().clearSession();
    queryClient.clear();
    return false;
  }
}
