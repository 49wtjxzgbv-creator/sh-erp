'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

export function Topbar() {
  const t = useTranslations('auth');
  const router = useRouter();
  const companySlug = useSessionStore((s) => s.companySlug);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <span className="text-sm text-muted-foreground">{companySlug}</span>
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        <LogOut className="mr-2 h-4 w-4" />
        {t('logout')}
      </Button>
    </header>
  );
}
