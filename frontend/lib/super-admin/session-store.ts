import { create } from 'zustand';

/**
 * Completely separate in-memory session store from the regular app's
 * `lib/auth/session-store.ts` — per the explicit "Company Admin і Super
 * Admin повинні бути повністю різними ролями... окрема авторизація"
 * requirement. No refresh token exists for a super-admin session (backend's
 * SuperAdminAuthService deliberately doesn't issue one — see its own header
 * comment), so there is nothing to silently restore on a page refresh: a
 * reload logs the super admin out and they log back in. Given this panel
 * is used for occasional admin operations, not continuous work, that's an
 * accepted tradeoff, not an oversight.
 */
export interface SuperAdminSessionState {
  accessToken: string | null;
  email: string | null;
  setSession: (session: { accessToken: string; email: string }) => void;
  clearSession: () => void;
}

export const useSuperAdminSessionStore = create<SuperAdminSessionState>((set) => ({
  accessToken: null,
  email: null,
  setSession: (session) => set({ accessToken: session.accessToken, email: session.email }),
  clearSession: () => set({ accessToken: null, email: null }),
}));

export function getSuperAdminAccessToken(): string | null {
  return useSuperAdminSessionStore.getState().accessToken;
}
