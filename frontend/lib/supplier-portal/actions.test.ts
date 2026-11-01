import { login, logout, restoreSession } from './actions';
import { useSupplierPortalSessionStore } from './session-store';
import { toast } from '@/lib/hooks/use-toast';

jest.mock('@/lib/hooks/use-toast', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

describe('lib/supplier-portal/actions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSupplierPortalSessionStore.setState({
      accessToken: null,
      email: null,
      companyId: null,
      companyName: null,
      activeConnectionId: null,
      isHydrated: false,
    });
    jest.clearAllMocks();
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

    it(
      'real incident (2026-11-01): a mid-session refresh that resolves to a DIFFERENT supplier account than this ' +
        'tab already knew (the shared httpOnly cookie was overwritten by another tab logging in as someone else) ' +
        'does NOT silently adopt the new identity',
      async () => {
        useSupplierPortalSessionStore.getState().setSession({ accessToken: 'old-tok', email: 'supplier-a@example.com', companyId: 'c1' });

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ accessToken: 'new-tok', email: 'supplier-b@example.com', supplierId: 's2', companyId: 'c2' }),
        }) as unknown as typeof fetch;

        const ok = await restoreSession();

        expect(ok).toBe(false);
        expect(useSupplierPortalSessionStore.getState().accessToken).toBeNull();
        expect(toast.error).toHaveBeenCalledTimes(1);
      },
    );

    it('a companyId change for the SAME account (e.g. switchConnection happened earlier in this tab) is not mistaken for a cross-tab swap — only email is compared', async () => {
      useSupplierPortalSessionStore.getState().setSession({ accessToken: 'tok', email: 'supplier-a@example.com', companyId: 'c1' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ accessToken: 'tok2', email: 'supplier-a@example.com', companyId: 'c2' }),
      }) as unknown as typeof fetch;

      const ok = await restoreSession();

      expect(ok).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
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
