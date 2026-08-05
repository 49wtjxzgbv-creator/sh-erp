import { create } from 'zustand';

/**
 * In-memory-only client auth state (Phase 2 §5). The access token deliberately
 * has NO persistence — not localStorage, not a JS-readable cookie — so it
 * disappears on tab close/refresh and must be re-derived via a silent
 * refresh (see lib/auth/actions.ts#restoreSession) using the httpOnly
 * refresh cookie that Next.js's own /api/auth/* routes own. This is what
 * keeps the access token out of reach of any XSS in this app.
 */
export interface SessionState {
  accessToken: string | null;
  userId: string | null;
  companyId: string | null;
  companySlug: string | null;
  roleId: string | null;
  /** True once we've resolved whether a session exists, one way or the other — gates the initial render of the (app) shell so it doesn't flash a login redirect before restoreSession() has had a chance to run. */
  isHydrated: boolean;
  setSession: (session: {
    accessToken: string;
    userId: string;
    companyId: string;
    companySlug?: string | null;
    roleId?: string | null;
  }) => void;
  clearSession: () => void;
  setHydrated: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  userId: null,
  companyId: null,
  companySlug: null,
  roleId: null,
  isHydrated: false,
  setSession: (session) =>
    set({
      accessToken: session.accessToken,
      userId: session.userId,
      companyId: session.companyId,
      companySlug: session.companySlug ?? null,
      roleId: session.roleId ?? null,
      isHydrated: true,
    }),
  clearSession: () =>
    set({
      accessToken: null,
      userId: null,
      companyId: null,
      companySlug: null,
      roleId: null,
      isHydrated: true,
    }),
  setHydrated: () => set({ isHydrated: true }),
}));

/** Non-hook accessor for use outside React (lib/api-client/http.ts's interceptor). */
export function getAccessToken(): string | null {
  return useSessionStore.getState().accessToken;
}
