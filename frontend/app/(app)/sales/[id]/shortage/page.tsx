'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useShortagePreview, useCreatePurchaseOrdersFromShortage } from '@/lib/hooks/use-sales';
import { ApiError } from '@/lib/api-client/types';
import type { PurchaseOrderGroupInput, ShortageGroupLineInput } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { SupplierRequestsPrint } from '@/components/domain/sales/supplier-requests-print';
import { LoadingBlock } from '@/components/ui/loading-block';

interface EditableLine extends ShortageGroupLineInput {
  /** Frozen at hydration — the original gross requirement, kept visible and never mutated by editing `qty`. */
  neededQty: number;
  currentStock: number;
}

interface EditableGroup {
  supplierId?: string;
  supplierName: string;
  lines: EditableLine[];
}

/**
 * The recursive, whole-order shortage analysis (Phase 1 §6.3) — grouped by
 * supplier, gross requirement shown next to current stock, never netted
 * automatically ("no hidden arithmetic" rule, confirmed from
 * customer-order-shortage.service.ts's own header comment). Every line's
 * "qty to order" is pre-filled from the preview's neededQty but is a plain
 * editable input — the human is expected to look at currentStock and adjust
 * before committing, not have it computed for them.
 */
export default function ShortagePreviewPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: preview, isLoading } = useShortagePreview(params.id);
  const createPOs = useCreatePurchaseOrdersFromShortage(params.id);

  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

  useEffect(() => {
    if (hydrated.current || !preview) return;
    hydrated.current = true;
    setGroups(
      preview.groups.map((g) => ({
        supplierId: g.supplierId ?? undefined,
        supplierName: g.supplierName,
        lines: g.lines.map((line) => ({
          kind: line.kind,
          productId: line.productId,
          subAssemblyId: line.subAssemblyId,
          description: line.description,
          qty: line.neededQty,
          neededQty: line.neededQty,
          currentStock: line.currentStock,
        })),
      })),
    );
  }, [preview]);

  function updateLineQty(groupIdx: number, lineIdx: number, qty: number) {
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx ? g : { ...g, lines: g.lines.map((l, li) => (li !== lineIdx ? l : { ...l, qty })) },
      ),
    );
  }

  async function handleCreate() {
    setError(null);
    setCreatedCount(null);
    const payload: PurchaseOrderGroupInput[] = groups
      .filter((g) => g.lines.some((l) => l.qty > 0))
      .map((g) => ({
        supplierId: g.supplierId,
        supplierName: g.supplierName,
        items: g.lines
          .filter((l) => l.qty > 0)
          .map(({ kind, productId, subAssemblyId, description, qty }) => ({ kind, productId, subAssemblyId, description, qty })),
      }));
    if (payload.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    try {
      const created = await createPOs.mutateAsync(payload);
      setCreatedCount(created.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  if (isLoading || !preview) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('shortagePreview')}</h2>
        {groups.length > 0 && <SupplierRequestsPrint groups={groups} />}
      </div>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('noShortage')}</p>}

      {groups.map((group, gi) => (
        <Card key={group.supplierId ?? `none-${gi}`}>
          <CardHeader>
            <CardTitle className="text-base">{group.supplierName}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('neededQty')}</TableHead>
                  <TableHead>{t('currentStock')}</TableHead>
                  <TableHead className="w-32">{t('qtyToOrder')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((line, li) => (
                  <TableRow key={li}>
                    <TableCell className="max-w-[260px] truncate" title={line.description}>{line.description}</TableCell>
                    <TableCell>{line.neededQty}</TableCell>
                    <TableCell>{line.currentStock}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={line.qty}
                        onChange={(e) => updateLineQty(gi, li, Number(e.target.value))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {groups.length > 0 && (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {createdCount !== null && <p className="text-sm text-success">{t('purchaseOrdersCreated', { count: createdCount })}</p>}
          <Button onClick={handleCreate} loading={createPOs.isPending}>
            {t('createPurchaseOrders')}
          </Button>
        </>
      )}
    </div>
  );
}
