'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';
import { Search } from 'lucide-react';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';

interface StockRow {
  itemId: string;
  orderId: string;
  orderNumber: string;
  productId: string | null;
  article: string;
  productName: string;
  orderDate: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyRemaining: number;
  supplierReadyQty: number | null;
  supplierShippedQty: number | null;
  photoUrl: string | null;
}

/**
 * "Склад" (2026-11-02) — not our own warehouse (too sensitive to show an
 * external supplier), but theirs: a lightweight ASN-style self-declaration
 * of how much of each open order line is already finished and sitting at
 * the supplier's own premises, not yet shipped. The user's own words:
 * "деталі які він виготовив але ще нам не відправив і вони висять на
 * балансі у нього на складі."
 *
 * "і де я маю вказувати що відвантажив" (2026-11-17) — extended with a
 * second self-declared number, supplierShippedQty (already dispatched/in
 * transit), editable the same way as supplierReadyQty. Deliberately NOT
 * `qtyReceived` — that field only moves once STAFF physically check goods
 * in on our side (PurchaseOrdersService#receive); letting a supplier
 * write it directly would let them overstate what we've actually
 * received, corrupting our own inventory/receiving records.
 *
 * "загальний по всіх замовленнях і окремо по кожному щоб відслідковувати
 * що на яке замовлення зроблено" (2026-11-18) — same rows, two views:
 * "Загальний" is the original flat cross-order list; "По замовленнях"
 * groups the identical rows under each order's own number, so a supplier
 * can see at a glance what's outstanding for ONE specific order instead
 * of hunting through the flat list.
 */
export default function SupplierPortalStockPage() {
  const t = useTranslations('supplierPortal');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [readyDraft, setReadyDraft] = useState<Record<string, string>>({});
  const [shippedDraft, setShippedDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // "і де по замовленнях щоб можна окремо було обирати яке замовлення"
  // (2026-11-18) — 'all' shows every group stacked (the original
  // behaviour); any other value narrows "По замовленнях" down to just
  // that one order.
  const [selectedOrderId, setSelectedOrderId] = useState<string>('all');
  // "коли в складі щось шукаєш в пошуку і натискаєш воно відкриває каталог
  // а не підсвічує у списку складу те що шукаємо" (2026-11-19) — selecting
  // a search suggestion used to `router.push` straight to that order's
  // page instead of staying on Склад; now it just highlights/scrolls to
  // the matching row in whichever view (Загальний/По замовленнях) is
  // already open. Cleared the moment the user types a NEW query, so a
  // stale highlight never lingers on an unrelated row.
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!highlightedItemId) return;
    rowRefs.current.get(highlightedItemId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedItemId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierPortalApi.get<{ items: StockRow[] }>('supplier-portal/stock');
      setRows(res.items);
      const seededReady: Record<string, string> = {};
      const seededShipped: Record<string, string> = {};
      for (const row of res.items) {
        seededReady[row.itemId] = row.supplierReadyQty != null ? String(row.supplierReadyQty) : '';
        seededShipped[row.itemId] = row.supplierShippedQty != null ? String(row.supplierShippedQty) : '';
      }
      setReadyDraft(seededReady);
      setShippedDraft(seededShipped);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(itemId: string) {
    setErrors((prev) => ({ ...prev, [itemId]: '' }));
    setSavingId(itemId);
    try {
      await supplierPortalApi.patch(`supplier-portal/stock/${itemId}`, {
        supplierReadyQty: Number(readyDraft[itemId] || 0),
        supplierShippedQty: Number(shippedDraft[itemId] || 0),
      });
      await load();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [itemId]: apiErrorMessage(err, tc('error')) }));
    } finally {
      setSavingId(null);
    }
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.article.toLowerCase().includes(query) || row.productName.toLowerCase().includes(query));
  }, [rows, search]);

  // Groups preserve the flat list's own order (whatever listStock returned
  // them in) — just bucketed by orderId, not re-sorted by anything new.
  const groupedByOrder = useMemo(() => {
    const groups: { orderId: string; orderNumber: string; rows: StockRow[] }[] = [];
    const indexByOrderId = new Map<string, number>();
    for (const row of filteredRows) {
      let idx = indexByOrderId.get(row.orderId);
      if (idx === undefined) {
        idx = groups.length;
        indexByOrderId.set(row.orderId, idx);
        groups.push({ orderId: row.orderId, orderNumber: row.orderNumber, rows: [] });
      }
      groups[idx].rows.push(row);
    }
    return groups;
  }, [filteredRows]);

  if (loading) {
    return <LoadingBlock />;
  }

  function renderRow(row: StockRow) {
    return (
      <TableRow
        key={row.itemId}
        ref={(el) => {
          if (el) rowRefs.current.set(row.itemId, el);
          else rowRefs.current.delete(row.itemId);
        }}
        className={cn(row.itemId === highlightedItemId && 'bg-primary/10')}
      >
        <TableCell>
          <Avatar src={row.photoUrl} size="sm" />
        </TableCell>
        <TableCell className="cursor-pointer" onClick={() => router.push(`/supplier-portal/orders/${row.orderId}`)}>
          {row.article}
        </TableCell>
        <TableCell className="max-w-[220px] truncate" title={row.productName}>{row.productName}</TableCell>
        <TableCell>{row.qtyOrdered}</TableCell>
        {/* "готово те що ми зробили а відвантажено це з того що ми зробили ... не має віднімати від того що залишилось виготовити" (2026-11-18) — supplierShippedQty is a SUBSET of supplierReadyQty (how much of "made" has shipped), not an additional qty on top of it, so only readyQty comes out of qtyRemaining here. */}
        <TableCell>{row.qtyRemaining - (row.supplierReadyQty ?? 0)}</TableCell>
        <TableCell>
          <Input
            type="number"
            step="any"
            min={0}
            max={row.qtyRemaining}
            value={readyDraft[row.itemId] ?? ''}
            onChange={(e) => setReadyDraft((prev) => ({ ...prev, [row.itemId]: e.target.value }))}
          />
        </TableCell>
        <TableCell>
          {/* "відвантажено це з того що ми зробили" (2026-11-18) — a SUBSET of "Готово у вас", not an additional qty, so its ceiling tracks the live ready draft (falling back to the row's own last-saved value while that draft is still empty), not qtyRemaining independently. */}
          <Input
            type="number"
            step="any"
            min={0}
            max={Number(readyDraft[row.itemId] || row.supplierReadyQty || 0)}
            value={shippedDraft[row.itemId] ?? ''}
            onChange={(e) => setShippedDraft((prev) => ({ ...prev, [row.itemId]: e.target.value }))}
          />
          {errors[row.itemId] && <p className="mt-1 text-xs text-destructive">{errors[row.itemId]}</p>}
        </TableCell>
        <TableCell>
          <Button type="button" size="sm" variant="outline" loading={savingId === row.itemId} onClick={() => handleSave(row.itemId)}>
            {tc('save')}
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  function renderTable(rowsToRender: StockRow[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12" />
            <TableHead>{t('article')}</TableHead>
            <TableHead>{t('productName')}</TableHead>
            <TableHead>{t('qty')}</TableHead>
            <TableHead>{t('stockRemainingLabel')}</TableHead>
            <TableHead className="w-48">{t('stockReadyLabel')}</TableHead>
            <TableHead className="w-48">{t('stockShippedLabel')}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowsToRender.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                {t('noStockItems')}
              </TableCell>
            </TableRow>
          ) : (
            rowsToRender.map(renderRow)
          )}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('navStock')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('navStock')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <EntityCombobox<StockRow>
            query={search}
            onQueryChange={(q) => {
              setSearch(q);
              setHighlightedItemId(null);
            }}
            open={searchOpen}
            onOpenChange={setSearchOpen}
            items={filteredRows}
            getKey={(row) => row.itemId}
            onSelect={(row) => {
              // Clears the query (not the combined "article — name" label
              // it used to set) — `filteredRows` filters by substring
              // match on the row's OWN article/name, so leaving that
              // combined label in `search` would filter every row out,
              // including the one just selected.
              setSearch('');
              setSearchOpen(false);
              setSelectedOrderId(row.orderId);
              setHighlightedItemId(row.itemId);
            }}
            placeholder={t('catalogSearchPlaceholder')}
            leading={<Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
            containerClassName="max-w-sm"
            renderItem={(row) => (
              <span className="flex items-center gap-2">
                <Avatar src={row.photoUrl} size="sm" className="shrink-0" zoomable={false} />
                <span className="truncate">
                  {row.article} — {row.productName}
                </span>
              </span>
            )}
          />
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">{t('stockViewAll')}</TabsTrigger>
              <TabsTrigger value="byOrder">{t('stockViewByOrder')}</TabsTrigger>
            </TabsList>
            <TabsContent value="all">{renderTable(filteredRows)}</TabsContent>
            <TabsContent value="byOrder" className="space-y-4">
              {groupedByOrder.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('noStockItems')}</p>
              ) : (
                <>
                  {/* "і де по замовленнях щоб можна окремо було обирати яке замовлення" (2026-11-18) — narrows the groups below down to just one order instead of always stacking every open order. */}
                  <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('stockAllOrdersOption')}</SelectItem>
                      {groupedByOrder.map((group) => (
                        <SelectItem key={group.orderId} value={group.orderId}>
                          {group.orderNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {groupedByOrder
                    .filter((group) => selectedOrderId === 'all' || group.orderId === selectedOrderId)
                    .map((group) => (
                      <div key={group.orderId} className="space-y-2">
                        <button
                          type="button"
                          className="text-sm font-medium text-primary hover:underline"
                          onClick={() => router.push(`/supplier-portal/orders/${group.orderId}`)}
                        >
                          {group.orderNumber}
                        </button>
                        {renderTable(group.rows)}
                      </div>
                    ))}
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
