'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Package, Layers, AlertTriangle, PackageCheck, Factory, ShoppingCart, Truck, Users } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { useDashboardSummary } from '@/lib/hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Real landing page, backed by GET /dashboard/summary (backend/src/modules/
 * dashboard/) — replaces the earlier deliberate placeholder (every card
 * used to show "—"; see git history on this file) now that Reports/
 * production/sales/procurement all have real data to pull from. Every card
 * links straight to the module it summarizes, so a glance-then-click flow
 * works for every role, not just admins.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tn = useTranslations('nav');
  const companySlug = useSessionStore((s) => s.companySlug);
  const { data, isLoading, isError } = useDashboardSummary();

  const cards: {
    key: string;
    navKey: string;
    href: string;
    icon: typeof Package;
    label: string;
    value: number | undefined;
    warn: boolean;
  }[] = [
    { key: 'products', navKey: 'catalog', href: '/catalog', icon: Package, label: t('productsTotal'), value: data?.productsCount, warn: false },
    {
      // Icon (not just color) reflects the actual state — a triangle-with-!
      // inside an otherwise-neutral gray box read as "something's wrong"
      // even when lowStockCount was 0 and every other style already said
      // "fine" (no red border/background/text, per `warn` below).
      key: 'lowStock',
      navKey: 'inventory',
      href: '/inventory',
      icon: (data?.lowStockCount ?? 0) > 0 ? AlertTriangle : PackageCheck,
      label: (data?.lowStockCount ?? 0) > 0 ? t('lowStock') : t('lowStockOk'),
      value: data?.lowStockCount,
      warn: (data?.lowStockCount ?? 0) > 0,
    },
    { key: 'assemblies', navKey: 'bom', href: '/bom', icon: Layers, label: t('assembliesTotal'), value: data?.assembliesCount, warn: false },
    { key: 'production', navKey: 'production', href: '/production', icon: Factory, label: t('activeProductionOrders'), value: data?.activeProductionOrders, warn: false },
    { key: 'procurement', navKey: 'procurement', href: '/procurement', icon: Truck, label: t('openPurchaseOrders'), value: data?.openPurchaseOrders, warn: false },
    { key: 'sales', navKey: 'sales', href: '/sales', icon: ShoppingCart, label: t('pendingCustomerOrders'), value: data?.pendingCustomerOrders, warn: false },
    { key: 'hr', navKey: 'hr', href: '/hr', icon: Users, label: t('activeEmployees'), value: data?.activeEmployees, warn: false },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {t('welcome')}
          {companySlug ? `, ${companySlug}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{t('overview')}</p>
      </div>

      {isError && <p className="text-sm text-destructive">{t('loadFailed')}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ key, navKey, href, icon: Icon, label, value, warn }) => (
          <Link key={key} href={href}>
            <Card className={cn('transition-colors hover:border-primary/50', warn && 'border-destructive/50 bg-destructive/5')}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground',
                    warn && 'bg-destructive/15 text-destructive',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <CardTitle className="text-base">{tn(navKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={cn('text-2xl font-semibold', warn && 'text-destructive')}>
                  {isLoading ? '—' : (value ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
