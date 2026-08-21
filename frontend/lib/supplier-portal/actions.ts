import { useSupplierPortalSessionStore } from './session-store';

/**
 * Client-side supplier-portal auth actions. These call our own same-origin
 * app/api/supplier-portal/auth/* route handlers (never the backend
 * directly) so the httpOnly refresh cookie stays entirely server-side —
 * mirrors lib/auth/actions.ts exactly, scoped to the Supplier Portal
 * session store.
 */

interface SupplierPortalSessionResponse {
  accessToken: string;
  email: string;
  supplierId: string;
  companyId: string;
  companyName: string;
  activeConnectionId: string;
}

async function parseOrThrow(res: Response): Promise<SupplierPortalSessionResponse> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return data as SupplierPortalSessionResponse;
}

export async function login(email: string, password: string): Promise<SupplierPortalSessionResponse> {
  const res = await fetch('/api/supplier-portal/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  useSupplierPortalSessionStore.getState().setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/supplier-portal/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    useSupplierPortalSessionStore.getState().clearSession();
  }
}

/**
 * Called once on mount of the Supplier Portal shell to silently re-derive
 * an access token from the httpOnly refresh cookie — the fix for "reload
 * logs the supplier out" (P0, 2026-08-20). Also used by
 * lib/supplier-portal/api.ts's 401-retry.
 */
export async function restoreSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/supplier-portal/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      useSupplierPortalSessionStore.getState().clearSession();
      return false;
    }
    const session = await parseOrThrow(res);
    useSupplierPortalSessionStore.getState().setSession(session);
    return true;
  } catch {
    useSupplierPortalSessionStore.getState().clearSession();
    return false;
  }
}

/**
 * Switches this session's active company (2026-08-21 P0, ADR-0012) — mints
 * a new access+refresh pair scoped to a different SupplierConnection, via
 * the same-origin proxy so the httpOnly refresh cookie stays server-side.
 * The backend re-verifies the target connection belongs to this supplier's
 * own organization and is ACTIVE — this call can never itself grant access
 * to a company the caller isn't actually connected to.
 */
export async function switchConnection(connectionId: string): Promise<SupplierPortalSessionResponse> {
  const res = await fetch('/api/supplier-portal/auth/switch-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  useSupplierPortalSessionStore.getState().setSession(session);
  return session;
}
