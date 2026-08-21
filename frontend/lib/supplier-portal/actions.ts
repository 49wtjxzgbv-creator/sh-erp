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
  /** Null for a standalone self-registered account with zero connections yet (2026-08-21 P3). */
  supplierId: string | null;
  companyId: string | null;
  companyName: string | null;
  activeConnectionId: string | null;
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

export interface SupplierInvitePreview {
  companyName: string;
  supplierName: string;
}

/**
 * Self-service registration (2026-08-21 P1, ADR-0013) — read-only, no
 * cookie side effect, so it hits the backend's public endpoint directly
 * rather than going through a same-origin proxy (unlike login/refresh/
 * switch-connection, which all mint a session and need one).
 */
export async function previewInvite(token: string): Promise<SupplierInvitePreview> {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
  const res = await fetch(`${API_BASE.replace(/\/?$/, '/')}supplier-portal/auth/invite/${encodeURIComponent(token)}`);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return data as SupplierInvitePreview;
}

/**
 * Redeems an invite link — creates a new Supplier Portal account or
 * connects an existing one to the inviting company. Goes through a
 * same-origin proxy (mirrors login/switch-connection) because success
 * mints a session and needs to set the httpOnly refresh cookie.
 */
export async function acceptInvite(
  token: string,
  dto: { email: string; password: string; organizationName?: string },
): Promise<SupplierPortalSessionResponse> {
  const res = await fetch(`/api/supplier-portal/auth/accept-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...dto }),
    credentials: 'include',
  });
  const session = await parseOrThrow(res);
  useSupplierPortalSessionStore.getState().setSession(session);
  return session;
}

/**
 * Fully standalone registration (2026-08-21 P2) — no invite token, zero
 * connections created. Hits the backend directly (no same-origin proxy
 * needed): unlike login/acceptInvite, success never mints a session, so
 * there's no cookie to set server-side.
 */
export async function registerStandalone(dto: {
  organizationName: string;
  email: string;
  password: string;
}): Promise<{ email: string }> {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
  const res = await fetch(`${API_BASE.replace(/\/?$/, '/')}supplier-portal/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return data as { email: string };
}
