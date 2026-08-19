'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useShortagePreview, useCreatePurchaseOrdersFromShortage, useSaveReservationDecisions } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatEur } from '@/lib/utils';
import type { PurchaseOrderGroupInput, ShortageGroupLineInput, ShortageSupplierOption } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Avatar } from '@/components/ui/avatar';
import { SupplierRequestsPrint } from '@/components/domain/sales/supplier-requests-print';
import { LoadingBlock } from '@/components/ui/loading-block';
import { RequirePermission } from '@/components/domain/auth/require-permission';

interface EditableLine extends Omit<ShortageGroupLineInput, 'price'> {
  /** Frozen at hydration — the original gross requirement, kept visible and never mutated by editing `qty`. */
  neededQty: number;
  currentStock: number;
  /** The resolved supplier's price, null when unknown — read-only display here, mapped to `ShortageGroupLineInput.price` (undefined instead of null) when submitting. */
  price: number | null;
  /** PRODUCT lines only — "Заброньовано": how much of neededQty to reserve from stock. Defaults to whatever was already auto-reserved. Editing this live-recomputes `qty` ("Кількість до замовлення") to the remainder. */
  reservedQty?: number;
}

interface EditableGroup {
  supplierId?: string;
  supplierName: string;
  lines: EditableLine[];
}

/** A line whose product/assembly has more than one linked supplier — not in any group yet until the user picks one (resolveAmbiguousLine). */
interface AmbiguousLine extends EditableLine {
  supplierOptions: ShortageSupplierOption[];
}

const ALL_SUPPLIERS = 'all';
const NO_SUPPLIER = '__none__';

function lineId(line: { productId?: string; subAssemblyId?: string; description: string }): string {
  return line.productId ?? line.subAssemblyId ?? line.description;
}

/** Sum of price × qty across a group's lines, skipping lines with no known price rather than treating them as zero. */
function groupTotal(group: EditableGroup): number {
  return group.lines
    .filter((l) => l.price != null)
    .reduce((sum, l) => sum + (l.price as number) * l.qty, 0);
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
 * supplier, gross requirement shown next to current stock and next to it
 * "Заброньовано" (stock-reservation spec, simplified 2026-08-19): a
 * customer order auto-reserves whatever's available the moment it's
 * created, so this page shows the RESULT of that (editable — the human can
 * take more or less from stock), not a from-scratch decision. "Кількість до
 * замовлення" is the remainder, live-recomputed as "Заброньовано" changes,
 * still independently editable. Two actions live under each supplier:
 * "Забронювати зі складу" (commits any changed reserved qty) and
 * "Надіслати заявку постачальнику" (creates the PurchaseOrder for that
 * group alone).
 */
function ShortagePreviewPageInner() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tp = useTranslations('print');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();

  const { data: preview, isLoading } = useShortagePreview(params.id);
  const createPOs = useCreatePurchaseOrdersFromShortage(params.id);
  const saveReservations = useSaveReservationDecisions(params.id);

  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [ambiguousLines, setAmbiguousLines] = useState<AmbiguousLine[]>([]);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [reservedGroupIdx, setReservedGroupIdx] = useState<number | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [printSupplierId, setPrintSupplierId] = useState<string>(ALL_SUPPLIERS);

  // One batch request per entity type for every line's photo across both
  // tables (resolved groups + still-ambiguous lines) — same pattern as
  // SupplierRequestsPrint's own photo lookup.
  const allLines = useMemo(() => [...groups.flatMap((g) => g.lines), ...ambiguousLines], [groups, ambiguousLines]);
  const productIds = useMemo(
    () => Array.from(new Set(allLines.filter((l) => l.kind === 'PRODUCT' && l.productId).map((l) => l.productId as string))),
    [allLines],
  );
  const assemblyIds = useMemo(
    () => Array.from(new Set(allLines.filter((l) => l.kind === 'ASSEMBLY' && l.subAssemblyId).map((l) => l.subAssemblyId as string))),
    [allLines],
  );
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  function linePhotoUrl(line: EditableLine): string | undefined {
    if (line.kind === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

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
          qty: previewQtyOverrides?.get(lineId(line)) ?? line.qtyToPurchase ?? line.neededQty,
          neededQty: line.neededQty,
          currentStock: line.currentStock,
          price: line.price,
          reservedQty: line.reservedQty,
          sourceRequirementId: line.sourceRequirementId,
        })),
      })),
    );
    setAmbiguousLines(
      preview.ambiguousLines.map((line) => ({
        kind: line.kind,
        productId: line.productId,
        subAssemblyId: line.subAssemblyId,
        description: line.description,
        qty: line.qtyToPurchase ?? line.neededQty,
        neededQty: line.neededQty,
        currentStock: line.currentStock,
        price: null,
        reservedQty: line.reservedQty,
        sourceRequirementId: line.sourceRequirementId,
        supplierOptions: line.supplierOptions ?? [],
      })),
    );
    if (previewSupplierParam && previewSupplierParam !== ALL_SUPPLIERS) setPrintSupplierId(previewSupplierParam);
  }, [preview, previewSupplierParam, previewQtyOverrides]);

  /** Moves a line out of `ambiguousLines` into the matching (or newly created) group once the user picks which of its several linked suppliers to order from. */
  function resolveAmbiguousLine(index: number, supplierId: string) {
    const line = ambiguousLines[index];
    if (!line) return;
    const option = line.supplierOptions.find((o) => o.supplierId === supplierId);
    if (!option) return;

    const { supplierOptions: _supplierOptions, ...plainLine } = line;
    const resolvedLine: EditableLine = { ...plainLine, price: option.price };
    setGroups((prev) => {
      const existingIdx = prev.findIndex((g) => g.supplierId === supplierId);
      if (existingIdx >= 0) {
        return prev.map((g, i) => (i === existingIdx ? { ...g, lines: [...g.lines, resolvedLine] } : g));
      }
      return [...prev, { supplierId, supplierName: option.supplierName, lines: [resolvedLine] }];
    });
    setAmbiguousLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLineQty(groupIdx: number, lineIdx: number, qty: number) {
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx ? g : { ...g, lines: g.lines.map((l, li) => (li !== lineIdx ? l : { ...l, qty })) },
      ),
    );
  }

  /** Editing "Заброньовано" live-recomputes "Кількість до замовлення" to the remainder — still independently editable afterward. */
  function updateLineReserved(groupIdx: number, lineIdx: number, reservedQty: number) {
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx
          ? g
          : {
              ...g,
              lines: g.lines.map((l, li) => (li !== lineIdx ? l : { ...l, reservedQty, qty: Math.max(l.neededQty - reservedQty, 0) })),
            },
      ),
    );
  }

  async function handleReserveFromStock(groupIdx: number) {
    setError(null);
    setReservedGroupIdx(null);
    const group = groups[groupIdx];
    const decisions = group.lines
      .filter((l) => l.kind === 'PRODUCT' && l.productId)
      .map((l) => ({ productId: l.productId as string, qtyFromStock: l.reservedQty ?? 0 }));
    if (decisions.length === 0) return;
    try {
      await saveReservations.mutateAsync(decisions);
      setReservedGroupIdx(groupIdx);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleSendToSupplier(groupIdx: number) {
    setError(null);
    setCreatedCount(null);
    const group = groups[groupIdx];
    const items = group.lines
      .filter((l) => l.qty > 0)
      .map(({ kind, productId, subAssemblyId, description, qty, price, sourceRequirementId }) => ({
        kind,
        productId,
        subAssemblyId,
        description,
        qty,
        price: price ?? undefined,
        sourceRequirementId,
      }));
    if (items.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    try {
      const created = await createPOs.mutateAsync([{ supplierId: group.supplierId, supplierName: group.supplierName, items }]);
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      {createdCount !== null && <p className="text-sm text-success">{t('purchaseOrdersCreated', { count: createdCount })}</p>}

      {groups.length === 0 && ambiguousLines.length === 0 && <p className="text-sm text-muted-foreground">{t('noShortage')}</p>}

      {ambiguousLines.length > 0 && (
        <Card className="border-warning">
          <CardHeader>
            <CardTitle className="text-base">{t('needsSupplierChoice')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">{t('photo')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('neededQty')}</TableHead>
                  <TableHead>{t('currentStock')}</TableHead>
                  <TableHead className="w-64">{t('chooseSupplier')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ambiguousLines.map((line, li) => (
                  <TableRow key={li}>
                    <TableCell>
                      <Avatar src={linePhotoUrl(line)} size="sm" />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate" title={line.description}>{line.description}</TableCell>
                    <TableCell>{line.neededQty}</TableCell>
                    <TableCell>{line.currentStock}</TableCell>
                    <TableCell>
                      <Select onValueChange={(supplierId) => resolveAmbiguousLine(li, supplierId)}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('chooseSupplier')} />
                        </SelectTrigger>
                        <SelectContent>
                          {line.supplierOptions.map((opt) => (
                            <SelectItem key={opt.supplierId} value={opt.supplierId}>
                              {opt.supplierName}
                              {opt.price != null ? ` — ${formatEur(opt.price)}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {groups.map((group, gi) => (
        <Card key={group.supplierId ?? `none-${gi}`}>
          <CardHeader>
            <CardTitle className="text-base">{group.supplierName}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">{t('photo')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('neededQty')}</TableHead>
                  <TableHead>{t('currentStock')}</TableHead>
                  <TableHead className="w-28">{t('reservedQty')}</TableHead>
                  <TableHead className="w-32">{t('qtyToOrder')}</TableHead>
                  <TableHead>{t('unitPrice')}</TableHead>
                  <TableHead>{t('expectedPrice')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((line, li) => (
                  <TableRow key={li}>
                    <TableCell>
                      <Avatar src={linePhotoUrl(line)} size="sm" />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate" title={line.description}>{line.description}</TableCell>
                    <TableCell>{line.neededQty}</TableCell>
                    <TableCell>{line.currentStock}</TableCell>
                    <TableCell>
                      {line.kind === 'PRODUCT' ? (
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          max={line.neededQty}
                          value={line.reservedQty ?? 0}
                          onChange={(e) => updateLineReserved(gi, li, Number(e.target.value))}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={line.qty}
                        onChange={(e) => updateLineQty(gi, li, Number(e.target.value))}
                      />
                    </TableCell>
                    <TableCell>{line.price != null ? formatEur(line.price) : '—'}</TableCell>
                    <TableCell>{line.price != null ? formatEur(line.price * line.qty) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" loading={saveReservations.isPending} onClick={() => handleReserveFromStock(gi)}>
                  {t('reserveFromStock')}
                </Button>
                <Button loading={createPOs.isPending} onClick={() => handleSendToSupplier(gi)}>
                  {t('sendSupplierRequest')}
                </Button>
                {reservedGroupIdx === gi && <span className="text-sm text-success">{t('reservedSuccessfully')}</span>}
              </div>
              <p className="text-right text-sm font-semibold">
                {tp('supplierRequestTotal')}: {formatEur(groupTotal(group))}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ShortagePreviewPage() {
  return (
    <RequirePermission permission="customer-orders:manage" redirectTo="/sales">
      <Suspense fallback={<LoadingBlock />}>
        <ShortagePreviewPageInner />
      </Suspense>
    </RequirePermission>
  );
}
