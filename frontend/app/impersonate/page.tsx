'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSessionStore } from '@/lib/auth/session-store';

/**
 * Landing page for a Super Admin's "impersonate" link
 * (`CompaniesAdminController#impersonate`, super-admin panel's own
 * "Impersonate" button). Takes the token + identity fields the backend
 * already resolved and drops them straight into the REGULAR app's session
 * store (lib/auth/session-store.ts) — the exact same store a normal
 * login/restoreSession populates, so every existing page/hook needs zero
 * special-casing to work under an impersonated session.
 *
 * Disclosed, deliberate limitation: the access token travels in this URL's
 * query string (visible in browser history and any Nginx access log that
 * isn't configured to redact query strings). Accepted for now given the
 * token is short-lived (JWT_ACCESS_TTL, ~15m) and this route immediately
 * clears it from the visible URL via router.replace() below — a real
 * hardening upgrade would POST this instead of GET, which needs its own
 * small form-based redirect from the super-admin panel; noted as a
 * follow-up in the final audit report, not silently treated as fully solved.
 */
export default function ImpersonatePage() {
  return (
    <Suspense fallback={null}>
      <ImpersonateInner />
    </Suspense>
  );
}

function ImpersonateInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useSessionStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const userId = searchParams.get('userId');
    const companyId = searchParams.get('companyId');
    const companySlug = searchParams.get('companySlug');
    const roleId = searchParams.get('roleId');

    if (!accessToken || !userId || !companyId) {
      setError('Missing impersonation parameters.');
      return;
    }

    setSession({ accessToken, userId, companyId, companySlug, roleId });
    // Clears the token out of the visible URL/history entry immediately.
    router.replace('/dashboard');
  }, [searchParams, setSession, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Signing in as impersonated user…</p>
    </div>
  );
}
