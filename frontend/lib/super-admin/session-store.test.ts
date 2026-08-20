import { useSuperAdminSessionStore, getSuperAdminAccessToken } from './session-store';

describe('useSuperAdminSessionStore', () => {
  beforeEach(() => {
    useSuperAdminSessionStore.setState({
      accessToken: null,
      email: null,
      permissions: [],
      isHydrated: false,
    });
  });

  it('starts unhydrated with no identity/permissions', () => {
    const state = useSuperAdminSessionStore.getState();
    expect(state.isHydrated).toBe(false);
    expect(state.accessToken).toBeNull();
    expect(state.permissions).toEqual([]);
  });

  it('setSession populates identity/permissions and marks hydrated', () => {
    useSuperAdminSessionStore.getState().setSession({
      accessToken: 'tok',
      email: 'admin@sh-erp.pro',
      permissions: ['companies:impersonate'],
    });
    const state = useSuperAdminSessionStore.getState();
    expect(state.accessToken).toBe('tok');
    expect(state.permissions).toEqual(['companies:impersonate']);
    expect(state.isHydrated).toBe(true);
    expect(getSuperAdminAccessToken()).toBe('tok');
  });

  it('clearSession wipes identity/permissions but still marks hydrated (we resolved: no session)', () => {
    useSuperAdminSessionStore.getState().setSession({ accessToken: 'tok', email: 'a@b.c', permissions: ['audit:read'] });
    useSuperAdminSessionStore.getState().clearSession();
    const state = useSuperAdminSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.permissions).toEqual([]);
    expect(state.isHydrated).toBe(true);
  });
});
