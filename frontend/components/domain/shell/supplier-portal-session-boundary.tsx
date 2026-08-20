'use client';

import { useEffect } from 'react';
import { useSupplierPortalSessionStore } from '@/lib/supplier-portal/session-store';
import { restoreSession } from '@/lib/supplier-portal/actions';

/**
 * Supplier Portal equivalent of components/domain/shell/session-boundary.tsx
 * — P0 fix (2026-08-20). On mount, if the store hasn't been hydrated yet in
 * this tab, silently exchanges the httpOnly `sh_supplier_portal_refresh_token`
 * cookie for a fresh access token via restoreSession(). SupplierPortalShell
 * still owns the "no session → redirect to /supplier-portal/login" decision;
 * this component only makes sure that decision waits for restoreSession()
 * to have a chance to run first.
 */
export function SupplierPortalSessionBoundary({ children }: { children: React.ReactNode }) {
  const isHydrated = useSupplierPortalSessionStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated) return;
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
