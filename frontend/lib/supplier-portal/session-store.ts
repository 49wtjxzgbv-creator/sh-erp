import { create } from 'zustand';

/**
 * Completely separate in-memory session store from both the regular app's
 * `lib/auth/session-store.ts` and `lib/super-admin/session-store.ts` — per
 * ADR-0011's "genuinely separate auth surface" decision. The access token
 * still lives only in memory (never localStorage/a JS-readable cookie), but
 * a reload/new tab no longer logs the supplier out (P0 fix, 2026-08-20):
 * `isHydrated` gates the initial render the same way the regular app's
 * `SessionBoundary` does, while
 * `lib/supplier-portal/actions.ts#restoreSession` silently exchanges the
 * new httpOnly `sh_supplier_portal_refresh_token` cookie for a fresh
 * access token.
 */
export interface SupplierPortalSessionState {
  accessToken: string | null;
  email: string | null;
  /** True once we've resolved whether a session exists, one way or the other — gates the initial render of the portal so it doesn't flash a login redirect before restoreSession() has had a chance to run. */
  isHydrated: boolean;
  setSession: (session: { accessToken: string; email: string }) => void;
  clearSession: () => void;
  setHydrated: () => void;
}

export const useSupplierPortalSessionStore = create<SupplierPortalSessionState>((set) => ({
  accessToken: null,
  email: null,
  isHydrated: false,
  setSession: (session) => set({ accessToken: session.accessToken, email: session.email, isHydrated: true }),
  clearSession: () => set({ accessToken: null, email: null, isHydrated: true }),
  setHydrated: () => set({ isHydrated: true }),
}));

export function getSupplierPortalAccessToken(): string | null {
  return useSupplierPortalSessionStore.getState().accessToken;
}
