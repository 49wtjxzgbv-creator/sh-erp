'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMaterialProvisioningSummary, useSaveMaterialProvisioningDecision } from '@/lib/hooks/use-material-provisioning';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type { CustomerOrderItem } from '@/lib/api-client/sales';
import type { MaterialProvisioningStatus, MaterialRequirementSummary } from '@/lib/api-client/material-provisioning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ReservationBreakdownPopover } from '@/components/domain/inventory/reservation-breakdown-popover';
import { LoadingBlock } from '@/components/ui/loading-block';

const STATUS_VARIANT: Record<MaterialProvisioningStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NOT_COVERED: 'destructive',
  PARTIALLY_RESERVED: 'warning',
  AWAITING_PURCHASE: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  FULLY_COVERED: 'success',
  ISSUED_TO_PRODUCTION: 'secondary',
};

function MaterialRow({ orderId, itemId, line, canManage }: { orderId: string; itemId: string; line: MaterialRequirementSummary; canManage: boolean }) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const saveDecision = useSaveMaterialProvisioningDecision(orderId, itemId);
  const [fromStock, setFromStock] = useState(String(line.decision?.qtyFromStock ?? 0));
  const [toPurchase, setToPurchase] = useState(String(line.decision?.qtyToPurchase ?? 0));
  const [error, setError] = useState<string | null>(null);

  const dirty = Number(fromStock) !== (line.decision?.qtyFromStock ?? 0) || Number(toPurchase) !== (line.decision?.qtyToPurchase ?? 0);

  async function handleSave() {
    setError(null);
    try {
      await saveDecision.mutateAsync({
        productId: line.productId,
        dto: { qtyFromStock: Number(fromStock) || 0, qtyToPurchase: Number(toPurchase) || 0 },
      });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="max-w-[220px] truncate" title={`${line.articleSnapshot} — ${line.productNameSnapshot}`}>
          {line.articleSnapshot} — {line.productNameSnapshot}
        </span>
      </TableCell>
      <TableCell numeric>{line.requiredQty}</TableCell>
      <TableCell numeric>{line.physicalQty}</TableCell>
      <TableCell numeric>
        <ReservationBreakdownPopover productId={line.productId} warehouseId={line.warehouseId} qty={line.reservedByOthersQty} excludeCustomerOrderItemId={itemId}>
          {line.reservedByOthersQty}
        </ReservationBreakdownPopover>
      </TableCell>
      <TableCell numeric>{line.availableQty}</TableCell>
      <TableCell numeric>{line.orderedFromSupplierQty}</TableCell>
      <TableCell numeric>{line.receivedQty}</TableCell>
      <TableCell numeric>{line.stillExpectedQty}</TableCell>
      <TableCell numeric>
        {line.coveredQty}/{line.requiredQty}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[line.status]}>{t(`provisioningStatus${line.status}`)}</Badge>
      </TableCell>
      {canManage && (
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Input
              className="h-8 w-16 text-right tabular-nums"
              type="number"
              step="any"
              min={0}
              value={fromStock}
              onChange={(e) => setFromStock(e.target.value)}
              title={t('provisioningQtyFromStock')}
            />
            <Input
              className="h-8 w-16 text-right tabular-nums"
              type="number"
              step="any"
              min={0}
              value={toPurchase}
              onChange={(e) => setToPurchase(e.target.value)}
              title={t('provisioningQtyToPurchase')}
            />
            {dirty && (
              <Button size="sm" loading={saveDecision.isPending} onClick={handleSave}>
                {tc('save')}
              </Button>
            )}
          </div>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </TableCell>
      )}
    </TableRow>
  );
}

function ItemProvisioningBlock({ orderId, item, canManage }: { orderId: string; item: CustomerOrderItem; canManage: boolean }) {
  const t = useTranslations('sales');
  const { data: assembly } = useAssembly(item.assemblyId);
  const { data: lines, isLoading } = useMaterialProvisioningSummary(orderId, item.id);

  if (isLoading) return <LoadingBlock />;
  if (!lines || lines.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : item.assemblyId} · {item.qty}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('provisioningMaterial')}</TableHead>
              <TableHead numeric>{t('provisioningNeeded')}</TableHead>
              <TableHead numeric>{t('provisioningPhysical')}</TableHead>
              <TableHead numeric>{t('provisioningReservedByOthers')}</TableHead>
              <TableHead numeric>{t('provisioningAvailable')}</TableHead>
              <TableHead numeric>{t('provisioningOrdered')}</TableHead>
              <TableHead numeric>{t('provisioningReceived')}</TableHead>
              <TableHead numeric>{t('provisioningStillExpected')}</TableHead>
              <TableHead numeric>{t('provisioningCovered')}</TableHead>
              <TableHead>{t('provisioningStatusHeader')}</TableHead>
              {canManage && <TableHead>{t('provisioningFromStock')} / {t('provisioningToPurchase')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <MaterialRow key={line.productId} orderId={orderId} itemId={item.id} line={line} canManage={canManage} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * §12: "Забезпечення матеріалами" — one collapsible block per order line
 * (a line's assembly tree can have many raw-material components, so this
 * stays a table per line rather than flattening every line's materials
 * into one page-wide list). Only rendered for lines whose assembly tree
 * actually resolves to raw PRODUCT components (an assembly built entirely
 * from purchased-whole sub-assemblies has none — ItemProvisioningBlock
 * returns null in that case).
 */
export function MaterialProvisioningCard({ orderId, items }: { orderId: string; items: CustomerOrderItem[] }) {
  const t = useTranslations('sales');
  const canManage = useHasPermission('customer-orders:manage');

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('materialProvisioning')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {items.map((item) => (
          <ItemProvisioningBlock key={item.id} orderId={orderId} item={item} canManage={canManage} />
        ))}
      </CardContent>
    </Card>
  );
}
