import { login, logout, restoreSession } from './actions';
import { useSuperAdminSessionStore } from './session-store';

describe('lib/super-admin/actions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSuperAdminSessionStore.setState({ accessToken: null, email: null, permissions: [], isHydrated: false });
  });

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  describe('login', () => {
    it('POSTs to the same-origin proxy route (never the backend directly) and populates the store', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'tok', email: 'admin@sh-erp.pro', permissions: ['companies:impersonate'] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await login('admin@sh-erp.pro', 'pw');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/super-admin/auth/login');
      expect(init.credentials).toBe('include');
      expect(useSuperAdminSessionStore.getState().accessToken).toBe('tok');
      expect(useSuperAdminSessionStore.getState().permissions).toEqual(['companies:impersonate']);
    });

    it('throws on a failed login and does not populate the store', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ message: 'Invalid email or password.' }),
      }) as unknown as typeof fetch;

      await expect(login('admin@sh-erp.pro', 'wrong')).rejects.toThrow('Invalid email or password.');
      expect(useSuperAdminSessionStore.getState().accessToken).toBeNull();
    });
  });

  describe('restoreSession — P0 fix (2026-08-20): reload/new-tab no longer logs the Super Admin out', () => {
    it('on success, silently re-derives a session from the httpOnly refresh cookie', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'fresh-tok', email: 'admin@sh-erp.pro', permissions: ['audit:read'] }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(true);
      expect(useSuperAdminSessionStore.getState().accessToken).toBe('fresh-tok');
    });

    it('on failure (no/expired cookie), clears the session and returns false rather than throwing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ message: 'No active super-admin session.' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(false);
      expect(useSuperAdminSessionStore.getState().accessToken).toBeNull();
      expect(useSuperAdminSessionStore.getState().isHydrated).toBe(true);
    });

    it('on a network error, clears the session and returns false rather than throwing', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      await expect(restoreSession()).resolves.toBe(false);
      expect(useSuperAdminSessionStore.getState().isHydrated).toBe(true);
    });
  });

  describe('logout', () => {
    it('POSTs to the logout proxy route and clears the store even on a non-ok backend response', async () => {
      useSuperAdminSessionStore.getState().setSession({ accessToken: 'tok', email: 'a@b.c', permissions: [] });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' }) as unknown as typeof fetch;

      await logout();

      expect(useSuperAdminSessionStore.getState().accessToken).toBeNull();
    });

    it('still clears local session state even if the request itself throws (network failure)', async () => {
      useSuperAdminSessionStore.getState().setSession({ accessToken: 'tok', email: 'a@b.c', permissions: [] });
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      await expect(logout()).rejects.toThrow('network down');

      expect(useSuperAdminSessionStore.getState().accessToken).toBeNull();
    });
  });
});
