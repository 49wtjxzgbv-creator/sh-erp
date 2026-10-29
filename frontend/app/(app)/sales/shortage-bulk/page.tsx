'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getCustomerOrder, getShortagePreview, createPurchaseOrdersFromShortage } from '@/lib/api-client/sales';
import type { ShortageLine, ShortageSupplierOption } from '@/lib/api-client/sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Avatar } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { LoadingBlock } from '@/components/ui/loading-block';
import { RequirePermission } from '@/components/domain/auth/require-permission';
import { SupplierRequestsPrint } from '@/components/domain/sales/supplier-requests-print';
import { openInPopup } from '@/components/domain/print/print-area';

const ALL_SUPPLIERS = 'all';
const NO_SUPPLIER = '__none__';

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

interface EditableLine extends ShortageLine {
  orderId: string;
  orderNumber: string;
  /** Editable "Кількість до замовлення" — defaults to `qtyToPurchase`/`neededQty` but never mutates those originals (same pattern as the single-order shortage page). */
  qty: number;
}

interface EditableGroup {
  supplierId?: string;
  supplierName: string;
  lines: EditableLine[];
}

interface AmbiguousLine extends EditableLine {
  supplierOptions: ShortageSupplierOption[];
}

function lineId(line: EditableLine): string {
  return `${line.orderId}:${line.productId ?? line.subAssemblyId ?? line.description}`;
}

function groupTotal(group: EditableGroup): number {
  return group.lines.filter((l) => l.price != null).reduce((sum, l) => sum + (l.price as number) * l.qty, 0);
}

/**
 * "в заявці постачальникам коли декілька замовлень воно просто складає
 * пдф файли до купи а не об'єднує схожі артикули складаючи кількість
 * разом з схожих замовлень" (2026-10-28) — the on-screen table and
 * `sendGroup` both need one row PER ORDER (editing/reservation and
 * `sourceRequirementId` are inherently per-order, see this file's own
 * header comment on why POs stay split per order underneath), but the
 * PRINTED document the supplier actually reads has no reason to expose
 * that internal bookkeeping: the same article needed by several orders
 * should read as ONE line with the combined quantity, not one line per
 * order. Merges same (kind, productId/subAssemblyId) lines within a
 * supplier group, summing `qty` and collecting every contributing
 * order's number into `orderNumber` (comma-joined) — print-only, never
 * fed back into `groups` state.
 */
function mergeLinesForPrint(lines: EditableLine[]) {
  const merged = new Map<string, { kind: EditableLine['kind']; productId?: string; subAssemblyId?: string; description: string; article: string | null; qty: number; price: number | null; orderNumbers: string[] }>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const key = `${line.kind}:${line.productId ?? line.subAssemblyId ?? line.description}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += line.qty;
      if (!existing.orderNumbers.includes(line.orderNumber)) existing.orderNumbers.push(line.orderNumber);
    } else {
      merged.set(key, {
        kind: line.kind,
        productId: line.productId,
        subAssemblyId: line.subAssemblyId,
        description: line.description,
        article: line.article,
        qty: line.qty,
        price: line.price,
        orderNumbers: [line.orderNumber],
      });
    }
  }
  return Array.from(merged.values()).map((m) => ({ ...m, orderNumber: m.orderNumbers.join(', ') }));
}

/**
 * "можна якось в продажах обирати декілька різних замовлень і з них
 * робити заявку постачальникам щоб не на кожне окремо" (2026-10-28) —
 * runs the SAME per-order shortage preview the single-order page uses
 * (`/sales/[id]/shortage`'s own `CustomerOrderShortageService#previewShortage`,
 * unchanged), once per selected order, and merges the results into one
 * by-supplier review. Deliberately does NOT merge same-product lines
 * ACROSS orders into a single summed row — each line keeps its own
 * `orderId`/`sourceRequirementId`, and "Надіслати заявку постачальнику"
 * still creates one PurchaseOrder PER (order, supplier) pair underneath,
 * exactly as the single-order flow always has. Two real correctness
 * reasons, not just caution: (1) `sourceRequirementId` is what makes
 * receiving a PO line auto-reserve for the ORIGINAL order — a merged
 * cross-order quantity has nowhere unambiguous to point that at; (2)
 * `PurchaseOrder.sourceCustomerOrderId` is a single header-level field
 * that FinanceService's own actual-cost rollup
 * (`sourceCustomerOrderId`-keyed) and the planner board both read per
 * order — a PO claiming to belong to several orders at once would make
 * that cost vanish from every order's own "Фактична вартість". This
 * page's entire value is doing the REVIEW once across many orders, not
 * collapsing the underlying POs.
 */
function BulkShortagePageInner() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();

  const orderIds = useMemo(() => {
    const raw = searchParams.get('orders');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const orderQueries = useQueries({
    queries: orderIds.map((id) => ({ queryKey: ['customer-orders', id], queryFn: () => getCustomerOrder(id) })),
  });
  const previewQueries = useQueries({
    queries: orderIds.map((id) => ({ queryKey: ['customer-orders', id, 'shortage-preview'], queryFn: () => getShortagePreview(id) })),
  });
  const isLoading = orderQueries.some((q) => q.isLoading) || previewQueries.some((q) => q.isLoading);
  const orderNumberById = useMemo(() => {
    const map = new Map<string, string>();
    orderIds.forEach((id, i) => {
      const order = orderQueries[i]?.data;
      map.set(id, order?.orderNumber ?? order?.clientName ?? id);
    });
    return map;
  }, [orderIds, orderQueries]);

  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [ambiguousLines, setAmbiguousLines] = useState<AmbiguousLine[]>([]);
  const originalDataRef = useRef<{ groups: EditableGroup[]; ambiguousLines: AmbiguousLine[] } | null>(null);
  const [ignoreStock, setIgnoreStock] = useState(false);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [sendingGroupIdx, setSendingGroupIdx] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [printSupplierId, setPrintSupplierId] = useState<string>(ALL_SUPPLIERS);

  // A preview tab (opened by handlePreview below) carries the supplier
  // filter and the live-typed quantities the opener had at that moment —
  // same reasoning as the single-order shortage page's own `isPreview`
  // handling (a fresh load here would otherwise only ever see the raw,
  // unedited per-order previews).
  const isPreview = searchParams.get('print') === '1';
  const previewSupplierParam = isPreview ? searchParams.get('supplier') : null;
  const previewQtyOverrides = useMemo(() => {
    if (!isPreview) return null;
    const raw = searchParams.get('qty');
    return raw ? parseQtyParam(raw) : null;
  }, [isPreview, searchParams]);

  useEffect(() => {
    if (hydrated.current || isLoading || orderIds.length === 0) return;
    hydrated.current = true;

    const groupBySupplier = new Map<string, EditableGroup>();
    const getGroup = (supplierId: string | undefined, supplierName: string): EditableGroup => {
      const key = supplierId ?? '__none__';
      if (!groupBySupplier.has(key)) groupBySupplier.set(key, { supplierId, supplierName, lines: [] });
      return groupBySupplier.get(key)!;
    };
    const ambiguous: AmbiguousLine[] = [];

    previewQueries.forEach((q, i) => {
      const preview = q.data;
      const orderId = orderIds[i];
      const orderNumber = orderNumberById.get(orderId) ?? orderId;
      if (!preview) return;
      for (const g of preview.groups) {
        const target = getGroup(g.supplierId ?? undefined, g.supplierName);
        for (const line of g.lines) {
          const editable: EditableLine = { ...line, orderId, orderNumber, qty: line.qtyToPurchase ?? line.neededQty };
          const override = previewQtyOverrides?.get(lineId(editable));
          if (override != null) editable.qty = override;
          target.lines.push(editable);
        }
      }
      for (const line of preview.ambiguousLines) {
        ambiguous.push({
          ...line,
          orderId,
          orderNumber,
          qty: line.qtyToPurchase ?? line.neededQty,
          supplierOptions: line.supplierOptions ?? [],
        });
      }
    });

    const hydratedGroups = Array.from(groupBySupplier.values());
    originalDataRef.current = { groups: hydratedGroups, ambiguousLines: ambiguous };
    setGroups(hydratedGroups);
    setAmbiguousLines(ambiguous);
    if (previewSupplierParam && previewSupplierParam !== ALL_SUPPLIERS) setPrintSupplierId(previewSupplierParam);
  }, [isLoading, orderIds, orderNumberById, previewQueries, previewSupplierParam, previewQtyOverrides]);

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

  /** Same "re-derive from the untouched original, every time" approach as the single-order page's own toggle — see its header comment for why. */
  function toggleIgnoreStock(ignore: boolean) {
    setIgnoreStock(ignore);
    const original = originalDataRef.current;
    if (!original) return;
    setGroups(original.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, qty: ignore ? l.neededQty : (l.qtyToPurchase ?? l.neededQty) })) })));
    setAmbiguousLines(original.ambiguousLines.map((l) => ({ ...l, qty: ignore ? l.neededQty : (l.qtyToPurchase ?? l.neededQty) })));
  }

  function updateLineQty(groupIdx: number, lineIdx: number, qty: number) {
    setGroups((prev) => prev.map((g, gi) => (gi !== groupIdx ? g : { ...g, lines: g.lines.map((l, li) => (li !== lineIdx ? l : { ...l, qty })) })));
  }

  function resolveAmbiguousLine(index: number, supplierId: string) {
    const line = ambiguousLines[index];
    if (!line) return;
    const option = line.supplierOptions.find((o) => o.supplierId === supplierId);
    if (!option) return;
    const { supplierOptions: _supplierOptions, ...plainLine } = line;
    const resolvedLine: EditableLine = { ...plainLine, price: option.price };
    setGroups((prev) => {
      const existingIdx = prev.findIndex((g) => g.supplierId === supplierId);
      if (existingIdx >= 0) return prev.map((g, i) => (i === existingIdx ? { ...g, lines: [...g.lines, resolvedLine] } : g));
      return [...prev, { supplierId, supplierName: option.supplierName, lines: [resolvedLine] }];
    });
    setAmbiguousLines((prev) => prev.filter((_, i) => i !== index));
  }

  /** Splits one supplier group's lines back out by their ORIGINATING order — `sourceCustomerOrderId` is a single field per PurchaseOrder, so a group spanning 3 orders becomes 3 separate POs, created here in one pass rather than requiring 3 manual visits to each order's own shortage page. */
  async function sendGroup(group: EditableGroup): Promise<number> {
    const byOrder = new Map<string, EditableLine[]>();
    for (const line of group.lines) {
      if (line.qty <= 0) continue;
      const list = byOrder.get(line.orderId) ?? [];
      list.push(line);
      byOrder.set(line.orderId, list);
    }
    let created = 0;
    for (const [orderId, lines] of byOrder) {
      const items = lines.map(({ kind, productId, subAssemblyId, description, qty, price, sourceRequirementId }) => ({
        kind,
        productId,
        subAssemblyId,
        description,
        qty,
        price: price ?? undefined,
        sourceRequirementId,
      }));
      const result = await createPurchaseOrdersFromShortage(orderId, [{ supplierId: group.supplierId, supplierName: group.supplierName, items }]);
      created += result.length;
    }
    return created;
  }

  async function handleSendGroup(groupIdx: number) {
    setError(null);
    setCreatedCount(null);
    setSendingGroupIdx(groupIdx);
    try {
      const created = await sendGroup(groups[groupIdx]);
      setCreatedCount(created);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSendingGroupIdx(null);
    }
  }

  async function handleSendAll() {
    setError(null);
    setCreatedCount(null);
    setSendingAll(true);
    let total = 0;
    try {
      for (const group of groups) {
        total += await sendGroup(group);
      }
      setCreatedCount(total);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSendingAll(false);
    }
  }

  const printGroups = groups.filter((g) => printSupplierId === ALL_SUPPLIERS || (g.supplierId ?? NO_SUPPLIER) === printSupplierId);

  /** Same same-URL-reopen trick the single-order page uses — serializes the supplier filter and the current (possibly hand-edited) quantities into the URL so the preview tab shows exactly what's about to be sent, not a fresh unedited preview. `orders=` is already part of `window.location.href` here, so it carries over for free. */
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
    openInPopup(url.toString());
  }

  if (orderIds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('bulkShortageNoOrders')}</p>;
  }
  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('bulkShortageTitle', { count: orderIds.length })}</h2>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={ignoreStock} onCheckedChange={toggleIgnoreStock} />
          {t('shortageIgnoreStock')}
        </label>
      </div>

      <p className="text-sm text-muted-foreground">{[...orderNumberById.values()].join(', ')}</p>

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
          <SupplierRequestsPrint
            groups={printGroups.map((g) => ({
              supplierId: g.supplierId,
              supplierName: g.supplierName,
              lines: mergeLinesForPrint(g.lines),
            }))}
            onPreview={handlePreview}
          />
          <Button loading={sendingAll} onClick={handleSendAll}>
            {t('sendAllRequests')}
          </Button>
        </div>
      )}

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
                  <TableHead>{t('orderNumber')}</TableHead>
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
                    <TableCell className="whitespace-nowrap text-muted-foreground">{line.orderNumber}</TableCell>
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
                  <TableHead>{t('orderNumber')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('neededQty')}</TableHead>
                  <TableHead>{t('currentStock')}</TableHead>
                  <TableHead className="w-32">{t('qtyToOrder')}</TableHead>
                  <TableHead>{t('unitPrice')}</TableHead>
                  <TableHead>{t('expectedPrice')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((line, li) => (
                  <TableRow key={lineId(line)}>
                    <TableCell>
                      <Avatar src={linePhotoUrl(line)} size="sm" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{line.orderNumber}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={line.description}>{line.description}</TableCell>
                    <TableCell>{line.neededQty}</TableCell>
                    <TableCell>{line.currentStock}</TableCell>
                    <TableCell>
                      <Input type="number" step="any" min={0} value={line.qty} onChange={(e) => updateLineQty(gi, li, Number(e.target.value))} />
                    </TableCell>
                    <TableCell>{line.price != null ? formatEur(line.price) : '—'}</TableCell>
                    <TableCell>{line.price != null ? formatEur(line.price * line.qty) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Button loading={sendingGroupIdx === gi} onClick={() => handleSendGroup(gi)}>
                {t('sendSupplierRequest')}
              </Button>
              <p className="text-right text-sm font-semibold">
                {t('qtyToOrder')}: {formatEur(groupTotal(group))}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function BulkShortagePage() {
  return (
    <RequirePermission permission="customer-orders:manage" redirectTo="/sales">
      <Suspense fallback={<LoadingBlock />}>
        <BulkShortagePageInner />
      </Suspense>
    </RequirePermission>
  );
}
