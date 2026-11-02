'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/loading-block';
import { supplierPortalApi } from '@/lib/supplier-portal/api';

interface UpcomingDeliveryRow {
  orderId: string;
  productId: string | null;
  article: string;
  productName: string;
  date: string;
  qty: number;
  scheduleStatus: string | null;
  photoUrl: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(date: Date, from: Date): number {
  return Math.round((date.getTime() - from.getTime()) / DAY_MS);
}

/**
 * "План виробництва" (2026-11-02) — every upcoming delivery obligation
 * across all open orders, in one cross-order picture instead of buried
 * per-order. A clean urgency-sectioned list rather than a literal Gantt
 * chart — see the plan's own "Competitive grounding" note for why: this
 * data model has no per-line "already shipped" flag (qtyReceived is a
 * single aggregate per item), so a bar-chart visualization would have to
 * fabricate a completion status it can't actually support. Grouping by
 * date urgency hits "visually clear and useful" honestly instead.
 */
export default function SupplierPortalDeliveriesPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const [rows, setRows] = useState<UpcomingDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierPortalApi.get<{ items: UpcomingDeliveryRow[] }>('supplier-portal/deliveries');
      setRows(res.items);
    } catch {
      setRows([]);
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

  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * DAY_MS);
  const twoWeeksFromNow = new Date(now.getTime() + 14 * DAY_MS);

  const overdue = rows.filter((r) => new Date(r.date) < now);
  const thisWeek = rows.filter((r) => new Date(r.date) >= now && new Date(r.date) <= weekFromNow);
  const nextTwoWeeks = rows.filter((r) => new Date(r.date) > weekFromNow && new Date(r.date) <= twoWeeksFromNow);
  const later = rows.filter((r) => new Date(r.date) > twoWeeksFromNow);

  const sections = [
    { key: 'overdue', title: t('deliveriesOverdue'), rows: overdue, tone: 'destructive' as const },
    { key: 'thisWeek', title: t('deliveriesThisWeek'), rows: thisWeek, tone: 'warning' as const },
    { key: 'nextTwoWeeks', title: t('deliveriesNextTwoWeeks'), rows: nextTwoWeeks, tone: 'secondary' as const },
    { key: 'later', title: t('deliveriesLater'), rows: later, tone: 'secondary' as const },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('navDeliveries')}</h1>

      {rows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('noDeliveries')}</CardContent>
        </Card>
      )}

      {sections.map(
        (section) =>
          section.rows.length > 0 && (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {section.title}
                  <Badge variant={section.tone}>{section.rows.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {section.rows.map((row, i) => {
                  const date = new Date(row.date);
                  const diff = daysBetween(date, now);
                  return (
                    <div
                      key={`${row.orderId}-${i}`}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary/50"
                      onClick={() => router.push(`/supplier-portal/orders/${row.orderId}`)}
                    >
                      <Avatar src={row.photoUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.article} — <span className="font-normal text-muted-foreground">{row.productName}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{t('deliveriesQtyLabel', { qty: row.qty })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm">{date.toLocaleDateString()}</p>
                        <p className={`text-xs ${diff < 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                          {diff < 0 ? t('deliveriesOverdueBy', { count: Math.abs(diff) }) : t('deliveriesInDays', { count: diff })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ),
      )}
    </div>
  );
}
