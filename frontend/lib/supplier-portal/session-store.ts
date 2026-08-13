import { create } from 'zustand';

/**
 * Completely separate in-memory session store from both the regular app's
 * `lib/auth/session-store.ts` and `lib/super-admin/session-store.ts` — per
 * ADR-0011's "genuinely separate auth surface" decision. No persistence
 * (not localStorage, not a JS-readable cookie) — same reasoning as the
 * regular app's session store: keeps the token out of reach of any XSS.
 * No refresh token exists either (backend's SupplierPortalAuthService
 * deliberately doesn't issue one, mirroring SuperAdminAuthService) — a
 * full page reload logs the supplier out and they log back in; the 7-day
 * token TTL (SUPPLIER_PORTAL_JWT_TTL) is about tolerating a long *working
 * session* of in-app navigation without re-prompting, not about surviving
 * a reload.
 */
export interface SupplierPortalSessionState {
  accessToken: string | null;
  email: string | null;
  setSession: (session: { accessToken: string; email: string }) => void;
  clearSession: () => void;
}

export const useSupplierPortalSessionStore = create<SupplierPortalSessionState>((set) => ({
  accessToken: null,
  email: null,
  setSession: (session) => set({ accessToken: session.accessToken, email: session.email }),
  clearSession: () => set({ accessToken: null, email: null }),
}));

export function getSupplierPortalAccessToken(): string | null {
  return useSupplierPortalSessionStore.getState().accessToken;
}
