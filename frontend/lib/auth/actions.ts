import { useSessionStore } from './session-store';
import { ApiError, type ApiErrorBody } from '../api-client/types';

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
}

async function parseOrThrow(res: Response): Promise<SessionResponse> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
  }
  return data as SessionResponse;
}

export async function login(companySlug: string, email: string, password: string): Promise<SessionResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companySlug, email, password }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  useSessionStore.getState().setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    useSessionStore.getState().clearSession();
  }
}

/**
 * Called once on mount of the authenticated shell (and available for the
 * public shell too, to redirect an already-signed-in visitor away from
 * /login) to silently re-derive an access token from the httpOnly refresh
 * cookie — necessary because the access token itself lives only in memory
 * and does not survive a page reload or new tab.
 */
export async function restoreSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      useSessionStore.getState().clearSession();
      return false;
    }
    const session = await parseOrThrow(res);
    useSessionStore.getState().setSession(session);
    return true;
  } catch {
    useSessionStore.getState().clearSession();
    return false;
  }
}
