import { login, logout, restoreSession } from './actions';
import { useSupplierPortalSessionStore } from './session-store';

describe('lib/supplier-portal/actions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSupplierPortalSessionStore.setState({ accessToken: null, email: null, isHydrated: false });
  });

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  describe('login', () => {
    it('POSTs to the same-origin proxy route (never the backend directly) and populates the store', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'tok', email: 'supplier@example.com', supplierId: 's1', companyId: 'c1' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await login('supplier@example.com', 'pw');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/supplier-portal/auth/login');
      expect(init.credentials).toBe('include');
      expect(useSupplierPortalSessionStore.getState().accessToken).toBe('tok');
    });

    it('throws on a failed login and does not populate the store', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ message: 'Invalid email or password.' }),
      }) as unknown as typeof fetch;

      await expect(login('supplier@example.com', 'wrong')).rejects.toThrow('Invalid email or password.');
      expect(useSupplierPortalSessionStore.getState().accessToken).toBeNull();
    });
  });

  describe('restoreSession — P0 fix (2026-08-20): reload/new-tab no longer logs the supplier out', () => {
    it('on success, silently re-derives a session from the httpOnly refresh cookie', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'fresh-tok', email: 'supplier@example.com', supplierId: 's1', companyId: 'c1' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(true);
      expect(useSupplierPortalSessionStore.getState().accessToken).toBe('fresh-tok');
    });

    it('on failure (no/expired cookie), clears the session and returns false rather than throwing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ message: 'No active supplier-portal session.' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(false);
      expect(useSupplierPortalSessionStore.getState().accessToken).toBeNull();
      expect(useSupplierPortalSessionStore.getState().isHydrated).toBe(true);
    });
  });

  describe('logout', () => {
    it('POSTs to the logout proxy route and clears the store even on a non-ok backend response', async () => {
      useSupplierPortalSessionStore.getState().setSession({ accessToken: 'tok', email: 'a@b.c' });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' }) as unknown as typeof fetch;

      await logout();

      expect(useSupplierPortalSessionStore.getState().accessToken).toBeNull();
    });
  });
});
