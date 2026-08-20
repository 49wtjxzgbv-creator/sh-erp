'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSuperAdminSessionStore } from '@/lib/super-admin/session-store';
import { logout } from '@/lib/super-admin/actions';
import { SuperAdminSessionBoundary } from '@/components/domain/shell/super-admin-session-boundary';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';

/**
 * Root of the Super Admin panel — a genuinely separate route tree from the
 * regular `(app)`/`(public)` groups, with its own auth guard (checks the
 * separate super-admin session store, not the regular one) and its own nav.
 * No shared layout chrome with Company Admin's UI at all, per the "окрема
 * адмін-панель" requirement. `/super-admin/login` is the one page under
 * this tree that must render without a session — it bypasses
 * SuperAdminSessionBoundary entirely (no point silently trying to restore a
 * session on the page whose whole job is establishing one).
 *
 * Split out of app/super-admin/layout.tsx (which stays a Server Component
 * so it can export `metadata` for noindex) — this file is 'use client' for
 * the session-store hooks, and Next's Metadata API can't be exported from
 * a Client Component.
 */
export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/super-admin/login';

  if (isLoginPage) {
    return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
  }

  return (
    <SuperAdminSessionBoundary>
      <AuthedSuperAdminShell>{children}</AuthedSuperAdminShell>
    </SuperAdminSessionBoundary>
  );
}

/**
 * Runs only after SuperAdminSessionBoundary has resolved (isHydrated), so
 * this is the first point it's safe to decide "no session → redirect" —
 * P0 fix (2026-08-20): previously this same check ran on first render,
 * before a reload's httpOnly cookie had any chance to be exchanged for a
 * fresh access token, so every reload bounced straight to /login.
 */
function AuthedSuperAdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('superAdmin');
  const router = useRouter();
  const { accessToken, email } = useSuperAdminSessionStore();

  useEffect(() => {
    if (!accessToken) router.replace('/super-admin/login');
  }, [accessToken, router]);

  if (!accessToken) {
    return null; // redirecting
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <span className="text-sm font-semibold tracking-tight sm:text-base">{t('panelTitle')}</span>
            <nav className="flex flex-wrap gap-3 text-sm text-slate-300 sm:gap-4">
              <Link href="/super-admin" className="hover:text-white">{t('navCompanies')}</Link>
              <Link href="/super-admin/users" className="hover:text-white">{t('navUsers')}</Link>
              <Link href="/super-admin/plans" className="hover:text-white">{t('navPlans')}</Link>
              <Link href="/super-admin/landing" className="hover:text-white">Головна сторінка</Link>
              <Link href="/super-admin/audit" className="hover:text-white">{t('navAudit')}</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400 sm:gap-3">
            <LanguageSwitcher />
            <span className="hidden sm:inline">{email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                router.replace('/super-admin/login');
              }}
            >
              {t('signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
