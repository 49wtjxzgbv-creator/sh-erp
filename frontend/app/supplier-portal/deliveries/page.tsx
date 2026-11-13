'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, CalendarClock, CalendarDays } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PrintArea, PrintButton, PrintDocumentHeader } from '@/components/domain/print/print-area';
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
  catalogEntryId: string | null;
}

type SectionKey = 'overdue' | 'thisWeek' | 'nextTwoWeeks' | 'later';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(date: Date, from: Date): number {
  return Math.round((date.getTime() - from.getTime()) / DAY_MS);
}

const SECTION_ICON: Record<SectionKey, typeof AlertTriangle> = {
  overdue: AlertTriangle,
  thisWeek: Clock,
  nextTwoWeeks: CalendarClock,
  later: CalendarDays,
};

// "гарний сучасний дизайн... візуально гарно і зрозуміло" (2026-11-03) — a
// left-accent + tinted-background row, same idiom operations-timeline.tsx's
// STAGE_BAR_STYLE already established for this app's stage/urgency coloring
// (border-l-{token} + bg-{token}/N + matching -foreground text), rather than
// inventing a new visual language. Same 4 semantic tokens this page's own
// badges already used (destructive/warning/secondary) — just extended from
// "colors one small badge" to "colors the whole row."
const SECTION_ROW_STYLE: Record<SectionKey, string> = {
  overdue: 'border-l-4 border-l-destructive bg-destructive/5',
  thisWeek: 'border-l-4 border-l-warning bg-warning/5',
  nextTwoWeeks: 'border-l-4 border-l-primary bg-primary/5',
  later: 'border-l-4 border-l-border bg-muted/30',
};

const SECTION_ICON_STYLE: Record<SectionKey, string> = {
  overdue: 'text-destructive',
  thisWeek: 'text-warning',
  nextTwoWeeks: 'text-primary',
  later: 'text-muted-foreground',
};

/**
 * "План виробництва" (2026-11-02) — every upcoming delivery obligation
 * across all open orders, in one cross-order picture instead of buried
 * per-order. A clean urgency-sectioned list rather than a literal Gantt
 * chart — see the plan's own "Competitive grounding" note for why: this
 * data model has no per-line "already shipped" flag (qtyReceived is a
 * single aggregate per item), so a bar-chart visualization would have to
 * fabricate a completion status it can't actually support. Grouping by
 * date urgency hits "visually clear and useful" honestly instead.
 *
 * Printable (2026-11-03 — "щоб потім цей графік також можна було
 * роздрукувати"): wraps the same data in a `<PrintArea>` as a clean,
 * flat, dated table — reuses this app's existing print scaffolding
 * (`print-area.tsx`) rather than a bespoke print flow. Deliberately only
 * `<PrintButton>` (straight to `window.print()`), not `<PreviewButton>` —
 * that popup-preview flow needs `?print=1` support wired into the shell
 * (`AppShellOrPrintPreview.tsx`), which `/supplier-portal/*` doesn't have
 * of its own (it's its own separate shell, ADR-0011) — adding that is a
 * real, separate shell-level change, not something to bolt on silently
 * here.
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

  const sectionOf = (date: Date): SectionKey => {
    if (date < now) return 'overdue';
    if (date <= weekFromNow) return 'thisWeek';
    if (date <= twoWeeksFromNow) return 'nextTwoWeeks';
    return 'later';
  };

  const overdue = rows.filter((r) => sectionOf(new Date(r.date)) === 'overdue');
  const thisWeek = rows.filter((r) => sectionOf(new Date(r.date)) === 'thisWeek');
  const nextTwoWeeks = rows.filter((r) => sectionOf(new Date(r.date)) === 'nextTwoWeeks');
  const later = rows.filter((r) => sectionOf(new Date(r.date)) === 'later');

  const sections: { key: SectionKey; title: string; rows: UpcomingDeliveryRow[]; tone: 'destructive' | 'warning' | 'secondary' | 'outline' }[] = [
    { key: 'overdue', title: t('deliveriesOverdue'), rows: overdue, tone: 'destructive' },
    { key: 'thisWeek', title: t('deliveriesThisWeek'), rows: thisWeek, tone: 'warning' },
    { key: 'nextTwoWeeks', title: t('deliveriesNextTwoWeeks'), rows: nextTwoWeeks, tone: 'secondary' },
    { key: 'later', title: t('deliveriesLater'), rows: later, tone: 'outline' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('navDeliveries')}</h1>
          <p className="text-sm text-muted-foreground">{t('deliveriesSubtitle')}</p>
        </div>
        {rows.length > 0 && <PrintButton label={t('deliveriesPrintButton')} className="no-print" />}
      </div>

      {rows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('noDeliveries')}</CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sections.map((section) => {
            const Icon = SECTION_ICON[section.key];
            return (
              <div key={section.key} className={`rounded-lg border border-border p-3 ${SECTION_ROW_STYLE[section.key]}`}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${SECTION_ICON_STYLE[section.key]}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {section.title}
                </div>
                <p className="mt-1 text-2xl font-semibold">{section.rows.length}</p>
              </div>
            );
          })}
        </div>
      )}

      {sections.map((section) => {
        if (section.rows.length === 0) return null;
        const Icon = SECTION_ICON[section.key];
        return (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className={`h-4 w-4 ${SECTION_ICON_STYLE[section.key]}`} />
                {section.title}
                <Badge variant={section.tone === 'outline' ? 'outline' : section.tone}>{section.rows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.rows.map((row, i) => {
                const date = new Date(row.date);
                const diff = daysBetween(date, now);
                return (
                  <div
                    key={`${row.orderId}-${i}`}
                    className={`flex cursor-pointer items-center gap-3 rounded-md py-2 pl-3 pr-2 transition-colors hover:brightness-95 ${SECTION_ROW_STYLE[section.key]}`}
                    // "коли ... натискаєш на деталь чи виріб у списку то
                    // потрібно щоб відкривалась інформація про деталь в
                    // каталозі" (2026-11-13) — opens the product's own
                    // catalog entry when one exists; falls back to the
                    // order (the previous, only, behavior) for a line with
                    // no catalog entry — a виріб/assembly line, or an
                    // article not yet in Products.
                    onClick={() =>
                      router.push(row.catalogEntryId ? `/supplier-portal/catalog/${row.catalogEntryId}` : `/supplier-portal/orders/${row.orderId}`)
                    }
                  >
                    <Avatar src={row.photoUrl} size="sm" zoomable={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.article} — <span className="font-normal text-muted-foreground">{row.productName}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{t('deliveriesQtyLabel', { qty: row.qty })}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium">{date.toLocaleDateString()}</p>
                      <p className={`text-xs ${diff < 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                        {diff < 0 ? t('deliveriesOverdueBy', { count: Math.abs(diff) }) : t('deliveriesInDays', { count: diff })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {rows.length > 0 && (
        <PrintArea>
          <PrintDocumentHeader title={t('navDeliveries')} subtitle={t('deliveriesSubtitle')} />
          <table>
            <thead>
              <tr>
                <th className="print-index-col">#</th>
                <th className="print-photo-col"></th>
                <th>{t('article')}</th>
                <th>{t('productName')}</th>
                <th>{t('qty')}</th>
                <th>{t('deliveriesPrintDateColumn')}</th>
                <th>{t('deliveriesPrintStatusColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const date = new Date(row.date);
                const section = sections.find((s) => s.rows.includes(row))!;
                return (
                  <tr key={`${row.orderId}-${i}`}>
                    <td>{i + 1}</td>
                    <td>{row.photoUrl && <Avatar src={row.photoUrl} size="sm" zoomable={false} className="rounded-none" />}</td>
                    <td>{row.article}</td>
                    <td>{row.productName}</td>
                    <td>{row.qty}</td>
                    <td>{date.toLocaleDateString()}</td>
                    <td className={section.key === 'overdue' ? 'font-semibold text-destructive' : undefined}>{section.title}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PrintArea>
      )}
    </div>
  );
}
