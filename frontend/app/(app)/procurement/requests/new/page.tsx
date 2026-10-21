'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useCreatePurchaseRequest } from '@/lib/hooks/use-procurement';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseRequestItemInput } from '@/lib/api-client/procurement';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { ItemFileAttachmentsPicker } from '@/components/domain/procurement/item-file-attachments-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { RequirePermission } from '@/components/domain/auth/require-permission';

interface EditableItemRow {
  key: string;
  productId?: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: string;
  expectedPrice: string;
  attachedFileIds: string[];
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `pr-item-row-${rowKeySeq}`;
}

export default function NewPurchaseRequestPage() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createRequest = useCreatePurchaseRequest();

  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [supplierNameSnapshot, setSupplierNameSnapshot] = useState('');
  const [fromName, setFromName] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<EditableItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), articleSnapshot: '', productNameSnapshot: '', qty: '', expectedPrice: '', attachedFileIds: [] }]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }
  function updateRow(key: string, patch: Partial<EditableItemRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function handlePickProduct(key: string, productId: string | undefined, label: string | undefined) {
    const row = rows.find((r) => r.key === key);
    // Attachments are sourced from the LINKED product's own documents — a
    // different product means a different, unrelated document set, so a
    // previous selection would silently point at the wrong product's files.
    const patch: Partial<EditableItemRow> = { productId, attachedFileIds: [] };
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
    const items: PurchaseRequestItemInput[] = [];
    for (const row of rows) {
      const qty = Number(row.qty);
      if (!row.articleSnapshot.trim() || !row.productNameSnapshot.trim() || !qty || qty <= 0) {
        setError(t('invalidRow'));
        return;
      }
      items.push({
        productId: row.productId,
        articleSnapshot: row.articleSnapshot.trim(),
        productNameSnapshot: row.productNameSnapshot.trim(),
        qty,
        expectedPrice: row.expectedPrice ? Number(row.expectedPrice) : undefined,
        attachedFileIds: row.attachedFileIds.length > 0 ? row.attachedFileIds : undefined,
      });
    }

    try {
      const request = await createRequest.mutateAsync({
        supplierId,
        supplierNameSnapshot: supplierNameSnapshot.trim(),
        comment: comment || undefined,
        fromName: fromName.trim() || undefined,
        items,
      });
      router.replace(`/procurement/requests/${request.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="purchase-requests:manage" redirectTo="/procurement/requests">
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newPurchaseRequest')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('orderHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('supplier')}</Label>
            <SupplierPicker
              value={supplierId}
              onChange={(id, label) => {
                setSupplierId(id);
                if (label) setSupplierNameSnapshot(label);
              }}
              onQueryChange={setSupplierNameSnapshot}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fromName">{t('fromName')}</Label>
            <Input id="fromName" placeholder={t('fromNamePlaceholder')} value={fromName} onChange={(e) => setFromName(e.target.value)} />
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
                <TableHead className="w-28">{t('qty')}</TableHead>
                <TableHead className="w-28">{t('expectedPrice')}</TableHead>
                <TableHead className="w-40">{t('attachFiles')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
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
                        value={row.qty}
                        onChange={(e) => updateRow(row.key, { qty: e.target.value })}
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
                      <ItemFileAttachmentsPicker
                        productId={row.productId}
                        value={row.attachedFileIds}
                        onChange={(ids) => updateRow(row.key, { attachedFileIds: ids })}
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
      <Button onClick={handleSubmit} loading={createRequest.isPending}>
        {tc('create')}
      </Button>
    </div>
    </RequirePermission>
  );
}
