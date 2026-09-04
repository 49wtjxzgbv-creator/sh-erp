'use client';

import { useEffect, useState } from 'react';
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
  ClipboardCheck,
  Truck,
  Wallet,
  ShoppingCart,
  FileText,
  Users,
  BarChart3,
  Sparkles,
  Bell,
  CreditCard,
  ShieldCheck,
  CalendarClock,
  GraduationCap,
  X,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileNav } from '@/components/domain/shell/mobile-nav-context';
import { useMyPermissions } from '@/lib/hooks/use-roles';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Logo } from '@/components/domain/shell/logo';

/**
 * One entry per backend module (Phase 2 §26 roadmap order). Routes not yet
 * built (frontend Tasks 43-52) still appear here so the nav is stable and
 * complete from the first authenticated-shell task — they 404 until their
 * module task lands, same as any in-progress multi-page app.
 */
export const NAV_ITEMS = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/production-plan', labelKey: 'productionPlan', icon: ClipboardCheck },
  { href: '/planner', labelKey: 'planner', icon: CalendarClock, permission: 'production-orders:read' },
  { href: '/catalog', labelKey: 'catalog', icon: Package },
  { href: '/bom', labelKey: 'bom', icon: ListTree },
  { href: '/inventory', labelKey: 'inventory', icon: Warehouse },
  { href: '/quotations', labelKey: 'quotations', icon: FileText, permission: 'quotations:read' },
  { href: '/sales', labelKey: 'sales', icon: ShoppingCart },
  { href: '/procurement', labelKey: 'procurement', icon: Truck },
  { href: '/finance', labelKey: 'finance', icon: Wallet, permission: 'finance:read' },
  { href: '/production', labelKey: 'production', icon: Factory },
  // `employees:manage`/`payroll:manage` gate EVERY route in this module,
  // including plain GET — there is no read-only view a restricted role
  // could land on, so hide the entry point outright rather than let it
  // 403 immediately.
  { href: '/hr', labelKey: 'hr', icon: Users, permission: 'employees:manage' },
  { href: '/reports', labelKey: 'reports', icon: BarChart3 },
  { href: '/ai', labelKey: 'ai', icon: Sparkles },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/training', labelKey: 'training', icon: GraduationCap },
  { href: '/billing', labelKey: 'billing', icon: CreditCard, permission: 'company:billing' },
  // Any one of these unlocks at least one admin tab (Users / Roles / Audit
  // log) — OR, not AND, unlike every other gate in this app.
  { href: '/admin', labelKey: 'admin', icon: ShieldCheck, permissionAnyOf: ['users:invite', 'users:manage', 'roles:manage', 'audit:read'] },
  { href: '/settings', labelKey: 'settings', icon: Settings },
] as const;

const COLLAPSE_STORAGE_KEY = 'sh-erp-sidebar-collapsed';

function NavLink({ href, labelKey, icon: Icon, collapsed }: (typeof NAV_ITEMS)[number] & { collapsed: boolean }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const link = (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md border-l-2 py-2 text-sm transition-colors',
        collapsed ? 'justify-center border-l-0 px-0' : 'pl-[10px] pr-3',
        active
          ? 'border-primary bg-secondary/70 font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{t(labelKey)}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{t(labelKey)}</TooltipContent>
    </Tooltip>
  );
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const { data: myPermissions } = useMyPermissions();
  const granted = new Set(myPermissions?.permissionKeys ?? []);
  // While permissions haven't loaded yet, show every item rather than
  // flashing a truncated nav — `visible` only ever removes items once we
  // positively know they're ungranted, never before that's known.
  const visible = NAV_ITEMS.filter((item) => {
    if (!myPermissions) return true;
    if ('permission' in item) return granted.has(item.permission);
    if ('permissionAnyOf' in item) return item.permissionAnyOf.some((k) => granted.has(k));
    return true;
  });
  return (
    <nav data-tour="sidebar-nav" className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {visible.map((item) => (
        <NavLink key={item.href} {...item} collapsed={collapsed} />
      ))}
    </nav>
  );
}

/**
 * Two renderings of the same nav: a persistent, collapsible column on
 * `md:`+ screens, and a slide-in drawer (triggered by Topbar's hamburger
 * button, state shared via MobileNavProvider) below that — this app
 * previously had NO navigation at all under 768px (the sidebar was just
 * `hidden`), a real usability gap on tablet/phone. Collapsed state persists
 * to localStorage (own key, alongside theme-provider's `sh-erp-theme`) —
 * read synchronously isn't needed here (unlike theme) since a collapsed
 * sidebar flashing briefly wide on load is a minor, one-time layout shift,
 * not a jarring color flash.
 */
export function Sidebar() {
  const { open, setOpen } = useMobileNav();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
    } catch {
      // Storage can throw in private-browsing/quota-exceeded edge cases — just stays expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Not worth surfacing to the user — collapse state just won't persist.
      }
      return next;
    });
  }

  return (
    <>
      <aside
        className={cn(
          'hidden shrink-0 border-r border-border bg-surface transition-[width] duration-150 md:flex md:flex-col',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('flex h-14 items-center gap-2 border-b border-border', collapsed ? 'justify-center px-2' : 'px-4')}>
          <Logo size={24} className="shrink-0" />
          {!collapsed && <span className="truncate text-sm font-semibold">SH ERP</span>}
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
            title={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
            className={cn(
              'flex w-full items-center gap-3 rounded-md py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground',
              collapsed ? 'justify-center' : 'px-3',
            )}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && <span>Згорнути</span>}
          </button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface shadow-lg">
            <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
              <div className="flex items-center gap-2">
                <Logo size={24} />
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
            <SidebarNav collapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
}
