import { useSuperAdminSessionStore } from './session-store';

/**
 * Client-side super-admin auth actions. These call our own same-origin
 * app/api/super-admin/auth/* route handlers (never the backend directly)
 * so the httpOnly refresh cookie stays entirely server-side — mirrors
 * lib/auth/actions.ts exactly, scoped to the Super Admin session store.
 */

interface SuperAdminSessionResponse {
  accessToken: string;
  email: string;
  permissions: string[];
}

async function parseOrThrow(res: Response): Promise<SuperAdminSessionResponse> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return data as SuperAdminSessionResponse;
}

export async function login(email: string, password: string): Promise<SuperAdminSessionResponse> {
  const res = await fetch('/api/super-admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  useSuperAdminSessionStore.getState().setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/super-admin/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    useSuperAdminSessionStore.getState().clearSession();
  }
}

/**
 * Called once on mount of the Super Admin shell to silently re-derive an
 * access token from the httpOnly refresh cookie — the fix for "reload logs
 * the Super Admin out" (P0, 2026-08-20). Also used by lib/super-admin/api.ts's
 * 401-retry.
 */
export async function restoreSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/super-admin/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      useSuperAdminSessionStore.getState().clearSession();
      return false;
    }
    const session = await parseOrThrow(res);
    useSuperAdminSessionStore.getState().setSession(session);
    return true;
  } catch {
    useSuperAdminSessionStore.getState().clearSession();
    return false;
  }
}
