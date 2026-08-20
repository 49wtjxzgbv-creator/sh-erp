'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSupplierPortalSessionStore } from '@/lib/supplier-portal/session-store';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';

/**
 * Root of the Supplier Portal — a genuinely separate route tree from
 * `(app)`/`(public)`/`super-admin`, with its own auth guard (checks the
 * separate supplier-portal session store) and no shared chrome with any of
 * them, per ADR-0011. `/supplier-portal/login` is the one page under this
 * tree that must render without a session — everything else redirects
 * there if `accessToken` is null.
 *
 * Split out of app/supplier-portal/layout.tsx (which stays a Server
 * Component so it can export `metadata` for noindex) — this file is
 * 'use client' for the session-store hooks, and Next's Metadata API can't
 * be exported from a Client Component.
 */
export function SupplierPortalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, email, clearSession } = useSupplierPortalSessionStore();
  const isLoginPage = pathname === '/supplier-portal/login';

  useEffect(() => {
    if (!accessToken && !isLoginPage) {
      router.replace('/supplier-portal/login');
    }
  }, [accessToken, isLoginPage, router]);

  if (!accessToken && !isLoginPage) {
    return null; // redirecting
  }

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
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
              onClick={() => {
                clearSession();
                router.replace('/supplier-portal/login');
              }}
            >
              {t('signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
