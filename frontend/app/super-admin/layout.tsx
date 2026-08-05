'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { useSuperAdminSessionStore } from '@/lib/super-admin/session-store';
import { Button } from '@/components/ui/button';

/**
 * Root of the Super Admin panel — a genuinely separate route tree from the
 * regular `(app)`/`(public)` groups, with its own auth guard (checks the
 * separate super-admin session store, not the regular one) and its own nav.
 * No shared layout chrome with Company Admin's UI at all, per the "окрема
 * адмін-панель" requirement. `/super-admin/login` is the one page under
 * this tree that must render without a session — everything else redirects
 * there if `accessToken` is null.
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, email, clearSession } = useSuperAdminSessionStore();
  const isLoginPage = pathname === '/super-admin/login';

  useEffect(() => {
    if (!accessToken && !isLoginPage) {
      router.replace('/super-admin/login');
    }
  }, [accessToken, isLoginPage, router]);

  if (!accessToken && !isLoginPage) {
    return null; // redirecting
  }

  if (isLoginPage) {
    return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">SH ERP — Super Admin</span>
            <nav className="flex gap-4 text-sm text-slate-300">
              <Link href="/super-admin" className="hover:text-white">Companies</Link>
              <Link href="/super-admin/users" className="hover:text-white">Users</Link>
              <Link href="/super-admin/plans" className="hover:text-white">Plans</Link>
              <Link href="/super-admin/audit" className="hover:text-white">Audit log</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span>{email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearSession();
                router.replace('/super-admin/login');
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
