'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useCreatePurchaseOrder } from '@/lib/hooks/use-procurement';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CreatePurchaseOrderItemInput } from '@/lib/api-client/procurement';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface EditableItemRow {
  key: string;
  productId?: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  qtyOrdered: string;
  expectedPrice: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `po-item-row-${rowKeySeq}`;
}

export default function NewPurchaseOrderPage() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createOrder = useCreatePurchaseOrder();

  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [supplierNameSnapshot, setSupplierNameSnapshot] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<EditableItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), articleSnapshot: '', productNameSnapshot: '', qtyOrdered: '', expectedPrice: '' }]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }
  function updateRow(key: string, patch: Partial<EditableItemRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function handlePickProduct(key: string, productId: string | undefined, label: string | undefined) {
    // ProductPicker's label is "article — name"; pre-fill the snapshot fields
    // from it (only if still blank — a picked product doesn't overwrite
    // manual edits) since articleSnapshot/productNameSnapshot are
    // independent, always-required fields per the real DTO (kept even when
    // productId is set, and the only source of truth when it's not).
    const row = rows.find((r) => r.key === key);
    const patch: Partial<EditableItemRow> = { productId };
    if (label) {
      const [article, name] = label.split(' — ');
      if (row && !row.articleSnapshot && article) patch.articleSnapshot = article;
      if (row && !row.productNameSnapshot && name) patch.productNameSnapshot = name;
    }
    updateRow(key, patch);
  }

  async function handleSubmit() {
    setError(null);
    if (!supplierNameSnapshot.trim()) {
      setError(t('invalidOrder'));
      return;
    }
    if (rows.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    const items: CreatePurchaseOrderItemInput[] = [];
    for (const row of rows) {
      const qty = Number(row.qtyOrdered);
      if (!row.articleSnapshot.trim() || !row.productNameSnapshot.trim() || !qty || qty <= 0) {
        setError(t('invalidRow'));
        return;
      }
      items.push({
        productId: row.productId,
        articleSnapshot: row.articleSnapshot.trim(),
        productNameSnapshot: row.productNameSnapshot.trim(),
        qtyOrdered: qty,
        expectedPrice: row.expectedPrice ? Number(row.expectedPrice) : undefined,
      });
    }

    try {
      const order = await createOrder.mutateAsync({
        supplierId,
        supplierNameSnapshot: supplierNameSnapshot.trim(),
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        comment: comment || undefined,
        items,
      });
      router.replace(`/procurement/${order.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newPurchaseOrder')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('orderHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('linkSupplier')}</Label>
            <SupplierPicker
              value={supplierId}
              onChange={(id, label) => {
                setSupplierId(id);
                if (label && !supplierNameSnapshot) setSupplierNameSnapshot(label);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplierNameSnapshot">{t('supplier')}</Label>
            <Input
              id="supplierNameSnapshot"
              value={supplierNameSnapshot}
              onChange={(e) => setSupplierNameSnapshot(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expectedDeliveryDate">{t('expectedDeliveryDate')}</Label>
            <Input
              id="expectedDeliveryDate"
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">{t('linkProduct')}</TableHead>
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead className="w-28">{t('qtyOrdered')}</TableHead>
                <TableHead className="w-28">{t('expectedPrice')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <ProductPicker value={row.productId} onChange={(id, label) => handlePickProduct(row.key, id, label)} />
                    </TableCell>
                    <TableCell>
                      <Input value={row.articleSnapshot} onChange={(e) => updateRow(row.key, { articleSnapshot: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input value={row.productNameSnapshot} onChange={(e) => updateRow(row.key, { productNameSnapshot: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={row.qtyOrdered}
                        onChange={(e) => updateRow(row.key, { qtyOrdered: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={row.expectedPrice}
                        onChange={(e) => updateRow(row.key, { expectedPrice: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addLine')}
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} loading={createOrder.isPending}>
        {tc('create')}
      </Button>
    </div>
  );
}
