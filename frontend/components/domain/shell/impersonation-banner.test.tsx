import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImpersonationBanner } from './impersonation-banner';
import { useSessionStore } from '@/lib/auth/session-store';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const logout = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/auth/actions', () => ({
  logout: () => logout(),
}));

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    replace.mockClear();
    logout.mockClear();
    useSessionStore.setState({
      accessToken: 'tok',
      userId: 'u1',
      companyId: 'c1',
      companySlug: 'acme',
      roleId: null,
      impersonatedBy: null,
      isHydrated: true,
    });
  });

  it('renders nothing for a regular (non-impersonated) session', () => {
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner with the impersonated company when impersonatedBy is set', () => {
    useSessionStore.setState({ impersonatedBy: 'super-admin-1', companySlug: 'acme' });
    render(<ImpersonationBanner />);
    expect(screen.getByText(/impersonationBannerText/)).toBeInTheDocument();
    expect(screen.getByText(/"acme"/)).toBeInTheDocument();
  });

  it('"Завершити" revokes the session server-side (logout) and returns to /super-admin', async () => {
    useSessionStore.setState({ impersonatedBy: 'super-admin-1', companySlug: 'acme' });
    render(<ImpersonationBanner />);

    fireEvent.click(screen.getByText('endImpersonation'));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/super-admin');
  });
});
