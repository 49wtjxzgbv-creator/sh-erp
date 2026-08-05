import { useSessionStore, getAccessToken } from './session-store';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      accessToken: null,
      userId: null,
      companyId: null,
      companySlug: null,
      roleId: null,
      isHydrated: false,
    });
  });

  it('starts unhydrated with no identity', () => {
    const state = useSessionStore.getState();
    expect(state.isHydrated).toBe(false);
    expect(state.accessToken).toBeNull();
  });

  it('setSession populates identity and marks hydrated', () => {
    useSessionStore.getState().setSession({
      accessToken: 'tok',
      userId: 'u1',
      companyId: 'c1',
      companySlug: 'shyring',
    });
    const state = useSessionStore.getState();
    expect(state.accessToken).toBe('tok');
    expect(state.companySlug).toBe('shyring');
    expect(state.isHydrated).toBe(true);
    expect(getAccessToken()).toBe('tok');
  });

  it('clearSession wipes identity but still marks hydrated (we resolved: no session)', () => {
    useSessionStore.getState().setSession({ accessToken: 'tok', userId: 'u1', companyId: 'c1' });
    useSessionStore.getState().clearSession();
    const state = useSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.isHydrated).toBe(true);
  });
});
