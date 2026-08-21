'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSupplierPortalSessionStore } from '@/lib/supplier-portal/session-store';
import { logout, switchConnection } from '@/lib/supplier-portal/actions';
import { listConnections, acceptConnection, declineConnection, type SupplierPortalConnection } from '@/lib/supplier-portal/connections';
import { SupplierPortalSessionBoundary } from '@/components/domain/shell/supplier-portal-session-boundary';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';

/**
 * Root of the Supplier Portal — a genuinely separate route tree from
 * `(app)`/`(public)`/`super-admin`, with its own auth guard (checks the
 * separate supplier-portal session store) and no shared chrome with any of
 * them, per ADR-0011. `/supplier-portal/login` and `/supplier-portal/register`
 * (2026-08-21 P1, ADR-0013 — self-service registration) are the two pages
 * under this tree that must render without a session — both bypass
 * SupplierPortalSessionBoundary entirely (no point silently trying to
 * restore a session on a page whose whole job is establishing one; without
 * this, an anonymous visitor hitting /register would be redirected straight
 * to /login before the registration form ever rendered).
 *
 * Split out of app/supplier-portal/layout.tsx (which stays a Server
 * Component so it can export `metadata` for noindex) — this file is
 * 'use client' for the session-store hooks, and Next's Metadata API can't
 * be exported from a Client Component.
 */
export function SupplierPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicPage = pathname === '/supplier-portal/login' || pathname === '/supplier-portal/register';

  if (isPublicPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  return (
    <SupplierPortalSessionBoundary>
      <AuthedSupplierPortalShell>{children}</AuthedSupplierPortalShell>
    </SupplierPortalSessionBoundary>
  );
}

/**
 * Runs only after SupplierPortalSessionBoundary has resolved (isHydrated),
 * so this is the first point it's safe to decide "no session → redirect" —
 * P0 fix (2026-08-20): previously this same check ran on first render,
 * before a reload's httpOnly cookie had any chance to be exchanged for a
 * fresh access token, so every reload bounced straight to /login.
 */
function AuthedSupplierPortalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const { accessToken, email, companyName, activeConnectionId } = useSupplierPortalSessionStore();

  useEffect(() => {
    if (!accessToken) router.replace('/supplier-portal/login');
  }, [accessToken, router]);

  if (!accessToken) {
    return null; // redirecting
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <span className="text-sm font-semibold tracking-tight sm:text-base">{t('panelTitle')}</span>
          <div className="flex items-center gap-2 text-sm text-muted-foreground sm:gap-3">
            <LanguageSwitcher />
            <span className="hidden sm:inline">{email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                router.replace('/supplier-portal/login');
              }}
            >
              {t('signOut')}
            </Button>
          </div>
        </div>
        <CompanyConnectionsBar companyName={companyName} activeConnectionId={activeConnectionId} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

/**
 * Company/Manufacturer selector + pending-connection acceptance (2026-08-21
 * P0, ADR-0012 — multi-company redesign). Deliberately hidden entirely when
 * there's exactly one ACTIVE connection and no PENDING ones — the vast
 * majority of suppliers today have exactly one company, so the portal stays
 * visually identical to before for them, per the explicit "don't redesign
 * this" requirement. Switching does a full page navigation (not just a
 * store update) so every already-loaded, company-scoped page state
 * (orders list, order detail) is discarded rather than silently showing
 * stale data from the previous company.
 */
function CompanyConnectionsBar({ companyName, activeConnectionId }: { companyName: string | null; activeConnectionId: string | null }) {
  const t = useTranslations('supplierPortal');
  const [connections, setConnections] = useState<SupplierPortalConnection[]>([]);
  const [switching, setSwitching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listConnections();
      setConnections(list);
    } catch {
      // Best-effort — worst case the selector just doesn't show extra options this render.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = connections.filter((c) => c.status === 'ACTIVE');
  const pending = connections.filter((c) => c.status === 'PENDING');

  if (active.length <= 1 && pending.length === 0) {
    return null;
  }

  async function handleSwitch(connectionId: string) {
    if (connectionId === activeConnectionId || switching) return;
    setSwitching(true);
    try {
      await switchConnection(connectionId);
      window.location.assign('/supplier-portal');
    } catch {
      setSwitching(false);
    }
  }

  async function handleAccept(connectionId: string) {
    setResolvingId(connectionId);
    try {
      await acceptConnection(connectionId);
      await load();
    } finally {
      setResolvingId(null);
    }
  }

  async function handleDecline(connectionId: string) {
    setResolvingId(connectionId);
    try {
      await declineConnection(connectionId);
      await load();
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-2 px-4 pb-3 sm:px-6">
      {pending.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>{t('pendingConnectionMessage', { company: c.companyName })}</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={resolvingId === c.id} onClick={() => handleAccept(c.id)}>
              {t('acceptConnection')}
            </Button>
            <Button size="sm" variant="outline" disabled={resolvingId === c.id} onClick={() => handleDecline(c.id)}>
              {t('declineConnection')}
            </Button>
          </div>
        </div>
      ))}
      {active.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('workingWith', { company: companyName ?? '' })}</span>
          <Select value={activeConnectionId ?? undefined} disabled={switching} onValueChange={handleSwitch}>
            <SelectTrigger className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {active.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
