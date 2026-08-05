'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/auth/session-store';
import { restoreSession } from '@/lib/auth/actions';

/**
 * Bridges the gap between middleware.ts's cookie-presence check (which only
 * proves a refresh cookie exists, not that it's valid, and doesn't put an
 * access token anywhere the client can use) and the in-memory
 * session store that lib/api-client/http.ts actually reads from. On mount,
 * if the store hasn't been hydrated yet in this tab, it silently exchanges
 * the httpOnly refresh cookie for a fresh access token via
 * restoreSession(). If that fails (cookie missing/expired/revoked), it
 * redirects to /login — a client-side fallback for the case middleware
 * already handles server-side, but necessary here too since a client-side
 * navigation (router.push) doesn't always re-run middleware against a
 * still-protected cookie edge case.
 */
export function SessionBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isHydrated = useSessionStore((s) => s.isHydrated);
  const accessToken = useSessionStore((s) => s.accessToken);

  useEffect(() => {
    if (isHydrated) return;
    restoreSession().then((ok) => {
      if (!ok) router.replace('/login');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!accessToken) {
    // Mid-redirect (the effect above already fired router.replace) — render
    // nothing rather than flashing authenticated chrome.
    return null;
  }

  return <>{children}</>;
}
