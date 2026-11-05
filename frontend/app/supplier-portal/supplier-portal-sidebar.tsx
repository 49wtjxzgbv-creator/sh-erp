'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, CalendarClock, Package, Warehouse, ShoppingCart, FileText, Scissors, Receipt, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/domain/shell/logo';

/**
 * Supplier-portal sidebar (2026-11-02) — same visual language as the main
 * app's own `components/domain/shell/sidebar.tsx` (flat nav array, lucide
 * icons, left-border+bg active-state treatment, hand-built mobile drawer —
 * no shadcn `Sheet` exists anywhere in this codebase), but deliberately a
 * separate, simpler component: a genuinely different route tree (ADR-0011)
 * with no RBAC filtering to replicate (every supplier sees every item) and
 * no collapse-to-icons toggle (six items, not twenty — the extra state
 * isn't earning its keep here).
 */
// `tour` matches a `data-tour="…"` the supplier-portal training course
// (app/supplier-portal/training-course.ts) spotlights, same convention as
// the main app's own `data-tour` usages (e.g. bom/[id]/layout.tsx's `tabs`
// array) — a plain extra field on the nav entry, not a separate registry.
const NAV_ITEMS = [
  { href: '/supplier-portal', labelKey: 'navDashboard', icon: LayoutDashboard, tour: 'supplier-nav-dashboard' },
  { href: '/supplier-portal/deliveries', labelKey: 'navDeliveries', icon: CalendarClock, tour: 'supplier-nav-deliveries' },
  { href: '/supplier-portal/catalog', labelKey: 'navCatalog', icon: Package, tour: 'supplier-nav-catalog' },
  { href: '/supplier-portal/stock', labelKey: 'navStock', icon: Warehouse, tour: 'supplier-nav-stock' },
  { href: '/supplier-portal/cutting', labelKey: 'navCutting', icon: Scissors, tour: 'supplier-nav-cutting' },
  { href: '/supplier-portal/orders', labelKey: 'navOrders', icon: ShoppingCart, tour: 'supplier-nav-orders' },
  { href: '/supplier-portal/requests', labelKey: 'navRequests', icon: FileText, tour: 'supplier-nav-requests' },
  { href: '/supplier-portal/finance', labelKey: 'navFinance', icon: Receipt, tour: 'supplier-nav-finance' },
] as const;

function NavLink({ href, labelKey, icon: Icon, tour, onNavigate }: (typeof NAV_ITEMS)[number] & { onNavigate?: () => void }) {
  const t = useTranslations('supplierPortal');
  const pathname = usePathname();
  const active = href === '/supplier-portal' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-tour={tour}
      className={cn(
        'flex items-center gap-3 rounded-md border-l-2 py-2 pl-[10px] pr-3 text-sm transition-colors',
        active
          ? 'border-primary bg-secondary/70 font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{t(labelKey)}</span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.href} {...item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export function SupplierPortalSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Logo size={24} className="shrink-0" />
          <span className="truncate text-sm font-semibold">SH ERP</span>
        </div>
        <SidebarNav />
      </aside>

      {/* Hamburger trigger — visible only below md, mirrors the main app's Topbar button. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Menu"
        className="fixed bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface shadow-lg">
            <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
              <div className="flex items-center gap-2">
                <Logo size={24} />
                <span className="text-sm font-semibold">SH ERP</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
