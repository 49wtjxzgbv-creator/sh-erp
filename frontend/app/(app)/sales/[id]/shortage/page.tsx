'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useShortagePreview, useCreatePurchaseOrdersFromShortage } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseOrderGroupInput, ShortageGroupLineInput } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
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

const ALL_SUPPLIERS = 'all';
const NO_SUPPLIER = '__none__';

function lineId(line: { productId?: string; subAssemblyId?: string; description: string }): string {
  return line.productId ?? line.subAssemblyId ?? line.description;
}

function parseQtyParam(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const pair of raw.split(',')) {
    const idx = pair.lastIndexOf(':');
    if (idx === -1) continue;
    const id = pair.slice(0, idx);
    const qty = Number(pair.slice(idx + 1));
    if (id && !Number.isNaN(qty)) map.set(id, qty);
  }
  return map;
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
function ShortagePreviewPageInner() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();

  const { data: preview, isLoading } = useShortagePreview(params.id);
  const createPOs = useCreatePurchaseOrdersFromShortage(params.id);

  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [printSupplierId, setPrintSupplierId] = useState<string>(ALL_SUPPLIERS);

  // In a preview tab opened via handlePreview below, `?print=1` carries the
  // supplier filter and the live-typed quantities the opener tab had at the
  // moment of preview — otherwise this fresh page load would only ever see
  // the raw, unedited shortage preview, silently diverging from what the
  // opener was about to print.
  const isPreview = searchParams.get('print') === '1';
  const previewSupplierParam = isPreview ? searchParams.get('supplier') : null;
  const previewQtyOverrides = useMemo(() => {
    if (!isPreview) return null;
    const raw = searchParams.get('qty');
    return raw ? parseQtyParam(raw) : null;
  }, [isPreview, searchParams]);

  useEffect(() => {
    if (hydrated.current || !preview) return;
    hydrated.current = true;
    const rawGroups =
      previewSupplierParam && previewSupplierParam !== ALL_SUPPLIERS
        ? preview.groups.filter((g) => (g.supplierId ?? NO_SUPPLIER) === previewSupplierParam)
        : preview.groups;
    setGroups(
      rawGroups.map((g) => ({
        supplierId: g.supplierId ?? undefined,
        supplierName: g.supplierName,
        lines: g.lines.map((line) => ({
          kind: line.kind,
          productId: line.productId,
          subAssemblyId: line.subAssemblyId,
          description: line.description,
          qty: previewQtyOverrides?.get(lineId(line)) ?? line.neededQty,
          neededQty: line.neededQty,
          currentStock: line.currentStock,
        })),
      })),
    );
    if (previewSupplierParam && previewSupplierParam !== ALL_SUPPLIERS) setPrintSupplierId(previewSupplierParam);
  }, [preview, previewSupplierParam, previewQtyOverrides]);

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
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const printGroups = groups.filter((g) => printSupplierId === ALL_SUPPLIERS || (g.supplierId ?? NO_SUPPLIER) === printSupplierId);

  function handlePreview() {
    const url = new URL(window.location.href);
    url.searchParams.set('print', '1');
    url.searchParams.set('supplier', printSupplierId);
    const qtyPayload = printGroups
      .flatMap((g) => g.lines)
      .filter((l) => l.qty > 0)
      .map((l) => `${lineId(l)}:${l.qty}`)
      .join(',');
    if (qtyPayload) url.searchParams.set('qty', qtyPayload);
    else url.searchParams.delete('qty');
    window.open(url.toString(), '_blank', 'noopener');
  }

  if (isLoading || !preview) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('shortagePreview')}</h2>
        {groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={printSupplierId} onValueChange={setPrintSupplierId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SUPPLIERS}>{t('allSuppliersPrint')}</SelectItem>
                {groups.map((g, gi) => (
                  <SelectItem key={g.supplierId ?? `none-${gi}`} value={g.supplierId ?? NO_SUPPLIER}>
                    {g.supplierName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SupplierRequestsPrint groups={printGroups} onPreview={handlePreview} />
          </div>
        )}
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

export default function ShortagePreviewPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ShortagePreviewPageInner />
    </Suspense>
  );
}
