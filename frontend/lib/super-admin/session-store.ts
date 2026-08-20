import { create } from 'zustand';

/**
 * Completely separate in-memory session store from the regular app's
 * `lib/auth/session-store.ts` — per the explicit "Company Admin і Super
 * Admin повинні бути повністю різними ролями... окрема авторизація"
 * requirement. The access token itself still lives only in memory, never
 * localStorage/a JS-readable cookie (same XSS-avoidance reasoning as the
 * regular app) — but a reload/new tab no longer logs the Super Admin out
 * (P0 fix, 2026-08-20): `isHydrated` gates the initial render the same way
 * the regular app's `SessionBoundary` does, while
 * `lib/super-admin/actions.ts#restoreSession` silently exchanges the new
 * httpOnly `sh_super_admin_refresh_token` cookie for a fresh access token.
 */
export interface SuperAdminSessionState {
  accessToken: string | null;
  email: string | null;
  /** Permission keys granted via this admin's SuperAdminRole (super-admin-permissions.catalogue.ts), returned fresh on every login/refresh. Empty if no role is assigned. */
  permissions: string[];
  /** True once we've resolved whether a session exists, one way or the other — gates the initial render of the panel so it doesn't flash a login redirect before restoreSession() has had a chance to run. */
  isHydrated: boolean;
  setSession: (session: { accessToken: string; email: string; permissions?: string[] }) => void;
  clearSession: () => void;
  setHydrated: () => void;
}

export const useSuperAdminSessionStore = create<SuperAdminSessionState>((set) => ({
  accessToken: null,
  email: null,
  permissions: [],
  isHydrated: false,
  setSession: (session) =>
    set({ accessToken: session.accessToken, email: session.email, permissions: session.permissions ?? [], isHydrated: true }),
  clearSession: () => set({ accessToken: null, email: null, permissions: [], isHydrated: true }),
  setHydrated: () => set({ isHydrated: true }),
}));

export function getSuperAdminAccessToken(): string | null {
  return useSuperAdminSessionStore.getState().accessToken;
}
