'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShoppingCart, FileText, Package, CalendarClock, GraduationCap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';
import { cn } from '@/lib/utils';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useTraining } from '@/components/domain/training/training-provider';

interface DashboardSummary {
  activeOrdersCount: number;
  pendingQuotesCount: number;
  catalogCount: number;
  overdueDeliveriesCount: number;
  upcomingDeliveriesCount: number;
}

/**
 * Дашборд (2026-11-02) — the new portal homepage, replacing the old
 * stacked-cards-of-everything root page (orders/requests/catalog each now
 * have their own route, linked from the sidebar). Same inline KPI-card
 * visual language as the main app's own dashboard
 * (`frontend/app/(app)/dashboard/page.tsx:108-129`) — icon-badge + big
 * number + label, `Link`-wrapped `Card`, destructive tint for a "warn"
 * state — no shared component exists for this anywhere in the codebase, so
 * this mirrors the pattern inline rather than inventing one.
 */
export default function SupplierPortalDashboardPage() {
  const t = useTranslations('supplierPortal');
  const { startCourse } = useTraining();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierPortalApi.get<DashboardSummary>('supplier-portal/dashboard-summary');
      setSummary(res);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <LoadingBlock />;
  }

  const hasOverdue = (summary?.overdueDeliveriesCount ?? 0) > 0;

  const cards = [
    { href: '/supplier-portal/orders', icon: ShoppingCart, label: t('kpiActiveOrders'), value: summary?.activeOrdersCount ?? 0 },
    { href: '/supplier-portal/requests', icon: FileText, label: t('kpiPendingQuotes'), value: summary?.pendingQuotesCount ?? 0 },
    { href: '/supplier-portal/catalog', icon: Package, label: t('kpiCatalogSize'), value: summary?.catalogCount ?? 0 },
    {
      href: '/supplier-portal/deliveries',
      icon: CalendarClock,
      label: t('kpiUpcomingDeliveries'),
      value: summary?.upcomingDeliveriesCount ?? 0,
      warn: hasOverdue,
      extra: hasOverdue ? t('kpiOverdueDeliveries', { count: summary?.overdueDeliveriesCount ?? 0 }) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('navDashboard')}</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => startCourse('supplier-full-cycle', 0)}>
          <GraduationCap className="mr-2 h-4 w-4" />
          {t('startTraining')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ href, icon: Icon, label, value, warn, extra }) => (
          <Link key={href} href={href}>
            <Card className={cn('transition-colors hover:border-primary/50', warn && 'border-destructive/50 bg-destructive/5')}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <CardTitle className="text-base">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={cn('text-2xl font-semibold', warn && 'text-destructive')}>{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
                {extra && <p className="mt-1 text-xs font-medium text-destructive">{extra}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
