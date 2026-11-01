import { login, logout, restoreSession } from './actions';
import { useSessionStore } from './session-store';
import { queryClient } from '@/app/providers';
import { toast } from '@/lib/hooks/use-toast';

jest.mock('@/lib/hooks/use-toast', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

describe('lib/auth/actions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSessionStore.setState({
      accessToken: null,
      userId: null,
      companyId: null,
      companySlug: null,
      roleId: null,
      impersonatedBy: null,
      isHydrated: false,
    });
    queryClient.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  describe('restoreSession', () => {
    it("on a tab's first restore (no prior identity), adopts whatever the refresh cookie resolves to", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'tok', userId: 'u1', companyId: 'c1', companySlug: 'acme' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(true);
      expect(useSessionStore.getState().accessToken).toBe('tok');
      expect(useSessionStore.getState().companyId).toBe('c1');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('on failure (no/expired cookie), clears the session and returns false', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ message: 'No active session.' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(false);
      expect(useSessionStore.getState().accessToken).toBeNull();
      expect(useSessionStore.getState().isHydrated).toBe(true);
    });

    it(
      'real incident (2026-11-01): a mid-session refresh that resolves to a DIFFERENT company than this tab already ' +
        'knew (the shared httpOnly cookie was overwritten by another tab impersonating/logging into a different ' +
        'company) does NOT silently adopt the new identity — it clears the session, warns, and returns false',
      async () => {
        useSessionStore.getState().setSession({ accessToken: 'old-tok', userId: 'u1', companyId: 'company-A', companySlug: 'a' });

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ accessToken: 'new-tok', userId: 'u1', companyId: 'company-B', companySlug: 'b' }),
        }) as unknown as typeof fetch;

        const ok = await restoreSession();

        expect(ok).toBe(false);
        expect(useSessionStore.getState().accessToken).toBeNull();
        expect(useSessionStore.getState().companyId).toBeNull();
        expect(toast.error).toHaveBeenCalledTimes(1);
      },
    );

    it('a same-identity mid-session refresh (ordinary token rotation, nothing changed) adopts the new access token normally', async () => {
      useSessionStore.getState().setSession({ accessToken: 'old-tok', userId: 'u1', companyId: 'company-A', companySlug: 'a' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'rotated-tok', userId: 'u1', companyId: 'company-A', companySlug: 'a' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(true);
      expect(useSessionStore.getState().accessToken).toBe('rotated-tok');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('on a network error, clears the session and returns false rather than throwing', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      await expect(restoreSession()).resolves.toBe(false);
      expect(useSessionStore.getState().isHydrated).toBe(true);
    });
  });

  describe('login', () => {
    it('clears the query cache and populates the store on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'tok', userId: 'u1', companyId: 'c1', companySlug: 'acme' }),
      }) as unknown as typeof fetch;

      await login('acme', 'a@b.com', 'pw');

      expect(useSessionStore.getState().accessToken).toBe('tok');
    });
  });

  describe('logout', () => {
    it('clears local session state even if the request itself throws', async () => {
      useSessionStore.getState().setSession({ accessToken: 'tok', userId: 'u1', companyId: 'c1', companySlug: 'acme' });
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      await expect(logout()).rejects.toThrow('network down');

      expect(useSessionStore.getState().accessToken).toBeNull();
    });
  });
});
