import { useSupplierPortalSessionStore, getSupplierPortalAccessToken } from './session-store';

describe('useSupplierPortalSessionStore', () => {
  beforeEach(() => {
    useSupplierPortalSessionStore.setState({
      accessToken: null,
      email: null,
      isHydrated: false,
    });
  });

  it('starts unhydrated with no identity', () => {
    const state = useSupplierPortalSessionStore.getState();
    expect(state.isHydrated).toBe(false);
    expect(state.accessToken).toBeNull();
  });

  it('setSession populates identity and marks hydrated', () => {
    useSupplierPortalSessionStore.getState().setSession({ accessToken: 'tok', email: 'supplier@example.com' });
    const state = useSupplierPortalSessionStore.getState();
    expect(state.accessToken).toBe('tok');
    expect(state.isHydrated).toBe(true);
    expect(getSupplierPortalAccessToken()).toBe('tok');
  });

  it('clearSession wipes identity but still marks hydrated (we resolved: no session)', () => {
    useSupplierPortalSessionStore.getState().setSession({ accessToken: 'tok', email: 'a@b.c' });
    useSupplierPortalSessionStore.getState().clearSession();
    const state = useSupplierPortalSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.isHydrated).toBe(true);
  });
});
