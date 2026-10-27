'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePreviewInvoiceStockImport, useApplyInvoiceStockImport } from '@/lib/hooks/use-invoice-stock-import';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { InvoiceImportPreviewResult } from '@/lib/api-client/invoice-stock-import';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';

/**
 * "а якось воно ж без аі розпізнавалось" (2026-10-27): upload a supplier
 * invoice PDF → preview {product, qty} rows (fast known-article parser,
 * AI vision fallback when nothing is found — see
 * InvoiceStockImportService's own header comment) → confirm into a chosen
 * warehouse as additive RECEIVE stock movements. Same preview/apply shape
 * as GermanPriceImportDialog, but as its own page (not a dialog) per the
 * user's own choice, and with a per-row EDITABLE qty — the fast parser's
 * quantity extraction is a heuristic, this is its safety net before
 * anything is actually written to stock.
 */
export default function InvoiceStockImportPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const canAdjustStock = useHasPermission('stock:adjust');
  const canCreateProduct = useHasPermission('products:write');
  const { data: warehouses } = useWarehouses();
  const previewMutation = usePreviewInvoiceStockImport();
  const applyMutation = useApplyInvoiceStockImport();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<InvoiceImportPreviewResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [editedQty, setEditedQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [createLineIndex, setCreateLineIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!warehouseId && warehouses?.length) {
      setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id);
    }
  }, [warehouses, warehouseId]);

  function reset() {
    setFile(null);
    setPreview(null);
    setExcluded(new Set());
    setEditedQty({});
    setError(null);
    setApplied(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handlePreview() {
    if (!file) return;
    setError(null);
    try {
      const result = await previewMutation.mutateAsync(file);
      setPreview(result);
      setEditedQty(Object.fromEntries(result.matched.map((m) => [m.productId, m.qty])));
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleApply() {
    if (!preview || !warehouseId) return;
    setError(null);
    const lines = preview.matched
      .filter((m) => !excluded.has(m.productId))
      .map((m) => ({ productId: m.productId, qty: editedQty[m.productId] ?? m.qty }));
    try {
      const res = await applyMutation.mutateAsync({ warehouseId, lines });
      setApplied(res.applied);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function toggle(productId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const matchedProductIds = preview?.matched.map((m) => m.productId) ?? [];
  const { data: photosByProduct } = useFilesForEntities('Product', matchedProductIds, 'PRODUCT_PHOTO');

  if (!canAdjustStock) return null;

  const includedCount = preview ? preview.matched.filter((m) => !excluded.has(m.productId)).length : 0;

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('invoiceImportTitle')}</CardTitle>
          <CardDescription>{t('invoiceImportDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setApplied(null);
              setError(null);
            }}
            className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder={t('warehouse')} />
            </SelectTrigger>
            <SelectContent>
              {warehouses?.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button onClick={handlePreview} loading={previewMutation.isPending} disabled={!file || !warehouseId}>
              {t('invoiceImportRecognize')}
            </Button>
            {(file || preview) && (
              <Button variant="outline" onClick={reset}>
                {tc('cancel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {applied !== null && <p className="text-sm">{t('invoiceImportApplied', { count: applied })}</p>}

      {preview && applied === null && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant={preview.method === 'fast' ? 'success' : 'secondary'}>
              {preview.method === 'fast' ? t('invoiceImportMethodFast') : t('invoiceImportMethodAi')}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {t('invoiceImportPreviewSummary', { matched: preview.matched.length, unmatched: preview.unmatched.length })}
            </span>
          </div>

          {preview.matched.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-32">{t('qty')}</TableHead>
                  <TableHead className="w-10" />
                  <TableHead>{t('product')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.matched.map((m) => (
                  <TableRow key={m.productId}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={!excluded.has(m.productId)}
                        onChange={() => toggle(m.productId)}
                        aria-label={m.article}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={editedQty[m.productId] ?? m.qty}
                        onChange={(e) => setEditedQty((prev) => ({ ...prev, [m.productId]: Number(e.target.value) }))}
                        disabled={excluded.has(m.productId)}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Avatar src={photosByProduct?.[m.productId]?.[0]?.downloadUrl} size="sm" />
                    </TableCell>
                    <TableCell title={m.rawText}>
                      {m.article} — {m.productName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {preview.unmatched.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('invoiceImportUnmatched', { count: preview.unmatched.length })}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoiceImportRawName')}</TableHead>
                    <TableHead className="w-24">{t('qty')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.unmatched.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell>{u.rawName}</TableCell>
                      <TableCell>{u.qty}</TableCell>
                      <TableCell>
                        {canCreateProduct && (
                          <Button variant="outline" size="sm" onClick={() => setCreateLineIndex(i)}>
                            {t('invoiceImportCreateProduct')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Button onClick={handleApply} loading={applyMutation.isPending} disabled={includedCount === 0}>
            {t('invoiceImportApply', { count: includedCount })}
          </Button>
        </div>
      )}

      {createLineIndex !== null && preview && (
        <CreateProductDialog
          open={createLineIndex !== null}
          onOpenChange={(open) => !open && setCreateLineIndex(null)}
          initialValues={{ name: preview.unmatched[createLineIndex].rawName, initialQty: preview.unmatched[createLineIndex].qty }}
          onCreated={(product) => {
            setPreview((prev) => {
              if (!prev) return prev;
              const line = prev.unmatched[createLineIndex];
              return {
                ...prev,
                unmatched: prev.unmatched.filter((_, i) => i !== createLineIndex),
                matched: [...prev.matched, { productId: product.id, article: product.article, productName: product.name, qty: line.qty, rawText: line.rawName }],
              };
            });
            setEditedQty((prev) => ({ ...prev, [product.id]: preview.unmatched[createLineIndex].qty }));
            setCreateLineIndex(null);
          }}
        />
      )}
    </div>
  );
}
