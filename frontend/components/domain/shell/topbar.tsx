'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, User, Menu } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';
import { GlobalSearch } from '@/components/domain/shell/global-search';
import { useMobileNav } from '@/components/domain/shell/mobile-nav-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Topbar() {
  const t = useTranslations('auth');
  const router = useRouter();
  const companySlug = useSessionStore((s) => s.companySlug);
  const { setOpen } = useMobileNav();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4 sm:gap-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="hidden shrink-0 text-sm font-medium text-muted-foreground sm:block">{companySlug}</span>
      <GlobalSearch className="flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <User className="h-3.5 w-3.5" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
