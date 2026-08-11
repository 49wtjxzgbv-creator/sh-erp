'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Package,
  Settings,
  Warehouse,
  ListTree,
  Factory,
  Truck,
  ShoppingCart,
  Users,
  BarChart3,
  Sparkles,
  Bell,
  CreditCard,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileNav } from '@/components/domain/shell/mobile-nav-context';

/**
 * One entry per backend module (Phase 2 §26 roadmap order). Routes not yet
 * built (frontend Tasks 43-52) still appear here so the nav is stable and
 * complete from the first authenticated-shell task — they 404 until their
 * module task lands, same as any in-progress multi-page app.
 */
const NAV_ITEMS = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/catalog', labelKey: 'catalog', icon: Package },
  { href: '/inventory', labelKey: 'inventory', icon: Warehouse },
  { href: '/bom', labelKey: 'bom', icon: ListTree },
  { href: '/production', labelKey: 'production', icon: Factory },
  { href: '/procurement', labelKey: 'procurement', icon: Truck },
  { href: '/sales', labelKey: 'sales', icon: ShoppingCart },
  { href: '/hr', labelKey: 'hr', icon: Users },
  { href: '/reports', labelKey: 'reports', icon: BarChart3 },
  { href: '/ai', labelKey: 'ai', icon: Sparkles },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/billing', labelKey: 'billing', icon: CreditCard },
  { href: '/admin', labelKey: 'admin', icon: ShieldCheck },
  { href: '/settings', labelKey: 'settings', icon: Settings },
] as const;

function SidebarNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Two renderings of the same nav: a persistent column on `md:`+ screens,
 * and a slide-in drawer (triggered by Topbar's hamburger button, state
 * shared via MobileNavProvider) below that — this app previously had NO
 * navigation at all under 768px (the sidebar was just `hidden`), a real
 * usability gap on tablet/phone.
 */
export function Sidebar() {
  const { open, setOpen } = useMobileNav();

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="h-6 w-6 rounded-md bg-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">SH ERP</span>
        </div>
        <SidebarNav />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card shadow-lg">
            <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-primary" aria-hidden="true" />
                <span className="text-sm font-semibold">SH ERP</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav />
          </aside>
        </div>
      )}
    </>
  );
}
