'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { usePurchaseOrders, useUpdatePurchaseOrderMilestones, useSuppliers } from '@/lib/hooks/use-procurement';
import type { PurchaseOrder, Supplier } from '@/lib/api-client/procurement';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';
import { EmptyState } from '@/components/ui/empty-state';

type MilestoneField = 'plannedSendAt' | 'sentToSupplierAt' | 'shippedBySupplierAt';

function toDateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

/**
 * One editable date cell for the staff-tracked timeline. Same uncontrolled-
 * Input + value-keyed-remount pattern as Склад's qty inline edit (see
 * inventory/page.tsx) — otherwise a successful save wouldn't visibly
 * refresh the field until a full reload.
 */
function MilestoneCell({ order, field }: { order: PurchaseOrder; field: MilestoneField }) {
  const updateMilestones = useUpdatePurchaseOrderMilestones();
  const current = order[field];

  return (
    <Input
      key={`${order.id}-${current ?? ''}`}
      type="date"
      defaultValue={toDateInputValue(current)}
      disabled={updateMilestones.isPending}
      className="h-8 w-36"
      onBlur={(e) => {
        const raw = toDateInputValue(current);
        if (e.target.value === raw) return;
        updateMilestones.mutate({ id: order.id, dto: { [field]: e.target.value || null } });
      }}
    />
  );
}

export default function ExpectedFromSupplierPage() {
  const t = useTranslations('inventory');
  const tp = useTranslations('procurement');
  const router = useRouter();
  const updateMilestones = useUpdatePurchaseOrderMilestones();

  const { data, isLoading } = usePurchaseOrders({ limit: 100 });
  const { data: suppliersData } = useSuppliers({ limit: 200 });

  const supplierById = useMemo(() => {
    const map = new Map<string, Supplier>();
    suppliersData?.items.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliersData]);

  // "Очікується" — still incoming. Once a PO is fully DELIVERED it belongs
  // to history (Історія руху / the PO's own page), not this tracking tab.
  const openOrders = useMemo(() => (data?.items ?? []).filter((o) => o.status !== 'DELIVERED'), [data]);

  async function markDelivered(order: PurchaseOrder) {
    await updateMilestones.mutateAsync({ id: order.id, dto: { deliveredAt: new Date().toISOString() } });
    router.push(`/procurement/${order.id}`);
  }

  if (isLoading) return <LoadingBlock />;

  if (openOrders.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t('noExpectedOrders')} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('expectedFromSupplierDescription')}</p>
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tp('supplier')}</TableHead>
              <TableHead>{tp('orderDate')}</TableHead>
              <TableHead>{tp('expectedDeliveryDate')}</TableHead>
              <TableHead>{t('plannedSendAt')}</TableHead>
              <TableHead>{t('sentToSupplierAt')}</TableHead>
              <TableHead>{t('shippedBySupplierAt')}</TableHead>
              <TableHead>{t('supplierPortalSync')}</TableHead>
              <TableHead className="w-40">{t('deliveredAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openOrders.map((order) => {
              const supplier = order.supplierId ? supplierById.get(order.supplierId) : undefined;
              const hasPortal = Boolean(supplier?.portalUser);
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => router.push(`/procurement/${order.id}`)}
                    >
                      {order.supplierNameSnapshot}
                    </button>
                    {hasPortal && (
                      <Badge variant="secondary" className="ml-2">
                        {t('supplierHasPortal')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(order.orderDate)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(order.expectedDeliveryDate)}</TableCell>
                  <TableCell>
                    <MilestoneCell order={order} field="plannedSendAt" />
                  </TableCell>
                  <TableCell>
                    <MilestoneCell order={order} field="sentToSupplierAt" />
                  </TableCell>
                  <TableCell>
                    <MilestoneCell order={order} field="shippedBySupplierAt" />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {order.supplierConfirmedAt ? (
                      <div className="space-y-0.5">
                        <p>
                          {t('supplierConfirmed')}: {formatDate(order.supplierConfirmedAt)}
                        </p>
                        {order.supplierConfirmedDeliveryDate && (
                          <p>
                            {tp('supplierConfirmedDeliveryDate')}: {formatDate(order.supplierConfirmedDeliveryDate)}
                          </p>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {order.deliveredAt ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="success">{formatDate(order.deliveredAt)}</Badge>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/procurement/${order.id}`)}>
                          {tp('receiveNow')}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => markDelivered(order)} loading={updateMilestones.isPending}>
                        {t('markDelivered')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
