'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, User, Menu, Bell } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';
import { GlobalSearch } from '@/components/domain/shell/global-search';
import { useMobileNav } from '@/components/domain/shell/mobile-nav-context';
import { NAV_ITEMS } from '@/components/domain/shell/sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Derives a breadcrumb trail from the URL alone — no per-page wiring across
 * 60 pages. Level 1 is always the matched NAV_ITEMS module (real, translated
 * label). Level 2 only renders for the one static sub-route worth naming
 * generically (`/new`); a dynamic `[id]` segment (uuid or numeric) is never
 * turned into a fake label — better to stop the trail at the module than
 * invent a "Details" crumb with no real content behind it.
 */
function useBreadcrumbTrail() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();

  const moduleItem = NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (!moduleItem) return null;

  const rest = pathname.slice(moduleItem.href.length).split('/').filter(Boolean);
  const isDetailSegment = rest.length > 0 && rest[0] !== 'new';

  return {
    module: { href: moduleItem.href, label: t(moduleItem.labelKey) },
    trailing: rest.length > 0 && !isDetailSegment ? tc('create') : null,
  };
}

function HeaderBreadcrumb() {
  const trail = useBreadcrumbTrail();
  if (!trail) return null;

  return (
    <Breadcrumb className="hidden shrink-0 lg:block">
      <BreadcrumbList>
        <BreadcrumbItem>
          {trail.trailing ? (
            <BreadcrumbLink href={trail.module.href}>{trail.module.label}</BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{trail.module.label}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {trail.trailing && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{trail.trailing}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function Topbar() {
  const t = useTranslations('auth');
  const tNav = useTranslations('nav');
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
      <HeaderBreadcrumb />
      <GlobalSearch className="flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" asChild aria-label={tNav('notifications')} title={tNav('notifications')}>
          <Link href="/notifications">
            <Bell className="h-4 w-4" />
          </Link>
        </Button>
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
