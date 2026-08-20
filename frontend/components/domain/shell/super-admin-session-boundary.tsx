'use client';

import { useEffect } from 'react';
import { useSuperAdminSessionStore } from '@/lib/super-admin/session-store';
import { restoreSession } from '@/lib/super-admin/actions';

/**
 * Super Admin equivalent of components/domain/shell/session-boundary.tsx —
 * P0 fix (2026-08-20). On mount, if the store hasn't been hydrated yet in
 * this tab, silently exchanges the httpOnly `sh_super_admin_refresh_token`
 * cookie for a fresh access token via restoreSession(). Renders children
 * regardless of the outcome (unlike the regular app's SessionBoundary,
 * there's no middleware-level redirect to fall back on here) — SuperAdminShell
 * itself still owns the "no session → redirect to /super-admin/login"
 * decision, this component only owns making sure that decision waits for
 * restoreSession() to have a chance to run first.
 */
export function SuperAdminSessionBoundary({ children }: { children: React.ReactNode }) {
  const isHydrated = useSuperAdminSessionStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated) return;
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-100 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
