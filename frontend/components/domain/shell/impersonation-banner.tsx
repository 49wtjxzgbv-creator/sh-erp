'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/auth/session-store';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

/**
 * P0 fix (2026-08-20): the impersonate flow previously had no visible
 * indicator once you landed in the dashboard — no way to tell you were
 * inside someone else's company, and no way back except manually navigating
 * to /login and re-authenticating as yourself. Shown whenever the current
 * session's `impersonatedBy` is set (session-store.ts) — true for the
 * initial impersonation handoff and every silent refresh afterward, since
 * it's a claim on the access token itself, not a one-time flag.
 *
 * "Завершити" revokes this session's refresh-token family server-side
 * (the same logout() every regular session uses) rather than just clearing
 * local state — the impersonation session itself must not remain valid
 * after this button is used.
 */
export function ImpersonationBanner() {
  const t = useTranslations('superAdmin');
  const router = useRouter();
  const impersonatedBy = useSessionStore((s) => s.impersonatedBy);
  const companySlug = useSessionStore((s) => s.companySlug);

  if (!impersonatedBy) return null;

  async function endImpersonation() {
    await logout();
    router.replace('/super-admin');
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-sm text-warning-foreground">
      <span>{t('impersonationBannerText', { company: companySlug ?? '' })}</span>
      <Button size="sm" variant="outline" className="shrink-0 border-warning-foreground/30 text-warning-foreground hover:bg-warning-foreground/10" onClick={endImpersonation}>
        {t('endImpersonation')}
      </Button>
    </div>
  );
}
