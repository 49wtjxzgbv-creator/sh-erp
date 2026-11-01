import { render, waitFor } from '@testing-library/react';
import { SessionBoundary } from './session-boundary';
import { useSessionStore } from '@/lib/auth/session-store';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const restoreSession = jest.fn();
jest.mock('@/lib/auth/actions', () => ({
  restoreSession: () => restoreSession(),
}));

describe('SessionBoundary', () => {
  beforeEach(() => {
    replace.mockClear();
    restoreSession.mockReset();
    useSessionStore.setState({
      accessToken: null,
      userId: null,
      companyId: null,
      companySlug: null,
      roleId: null,
      impersonatedBy: null,
      isHydrated: false,
    });
  });

  it('on first mount with no session, calls restoreSession and redirects to /login on failure', async () => {
    restoreSession.mockResolvedValue(false);

    render(<SessionBoundary>content</SessionBoundary>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('renders children once hydrated with a valid access token', async () => {
    restoreSession.mockImplementation(async () => {
      useSessionStore.getState().setSession({ accessToken: 'tok', userId: 'u1', companyId: 'c1', companySlug: 'acme' });
      return true;
    });

    const { findByText } = render(<SessionBoundary>content</SessionBoundary>);

    expect(await findByText('content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it(
    'real incident (2026-11-01): a session cleared well AFTER the initial mount (restoreSession\'s own cross-tab ' +
      'identity-swap guard firing from a later 401-retry, not the mount effect) still redirects to /login instead ' +
      'of rendering a blank page forever',
    async () => {
      restoreSession.mockResolvedValue(true);
      useSessionStore.setState({ accessToken: 'tok', userId: 'u1', companyId: 'c1', companySlug: 'acme', isHydrated: true });

      render(<SessionBoundary>content</SessionBoundary>);

      // Simulate restoreSession()'s own identity-swap guard clearing the
      // session later in the tab's life, well after this component mounted
      // already-hydrated — the mount effect above never re-fires for this.
      useSessionStore.getState().clearSession();

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    },
  );
});
