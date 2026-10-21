'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import {
  usePurchaseRequest,
  useUpdatePurchaseRequest,
  useSavePurchaseRequestItems,
  useSendPurchaseRequest,
  useGeneratePurchaseRequestPdf,
  useCancelPurchaseRequest,
  useConvertPurchaseRequestToOrder,
  useDeletePurchaseRequest,
} from '@/lib/hooks/use-procurement';
import { getFileDownloadUrl } from '@/lib/api-client/files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseRequestStatus, PurchaseRequestItemInput } from '@/lib/api-client/procurement';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { ItemFileAttachmentsPicker } from '@/components/domain/procurement/item-file-attachments-picker';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useHasPermission } from '@/lib/hooks/use-roles';

const STATUS_VARIANT: Record<PurchaseRequestStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'destructive',
};

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
  return `pr-detail-item-row-${rowKeySeq}`;
}

export default function PurchaseRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: request, isLoading } = usePurchaseRequest(params.id);
  const updateHeader = useUpdatePurchaseRequest(params.id);
  const saveItems = useSavePurchaseRequestItems(params.id);
  const sendRequest = useSendPurchaseRequest(params.id);
  const generatePdf = useGeneratePurchaseRequestPdf(params.id);
  const cancelRequest = useCancelPurchaseRequest(params.id);
  const convertToOrder = useConvertPurchaseRequestToOrder(params.id);
  const deleteRequest = useDeletePurchaseRequest();
  const canManage = useHasPermission('purchase-requests:manage');

  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [supplierNameSnapshot, setSupplierNameSnapshot] = useState('');
  const [fromName, setFromName] = useState('');
  const [comment, setComment] = useState('');
  const [headerDirty, setHeaderDirty] = useState(false);
  const [rows, setRows] = useState<EditableItemRow[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setSupplierId(request.supplierId ?? undefined);
    setSupplierNameSnapshot(request.supplierNameSnapshot);
    setFromName(request.fromName ?? '');
    setComment(request.comment ?? '');
    setHeaderDirty(false);
    setRows(
      (request.items ?? []).map((item) => ({
        key: newRowKey(),
        productId: item.productId ?? undefined,
        articleSnapshot: item.articleSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        qty: String(item.qty),
        expectedPrice: item.expectedPrice != null ? String(item.expectedPrice) : '',
        attachedFileIds: item.attachedFileIds ?? [],
      })),
    );
    setItemsDirty(false);
  }, [request]);

  if (isLoading || !request) {
    return <LoadingBlock />;
  }

  const isEditable = request.status === 'DRAFT' || request.status === 'SENT';
  const canEdit = canManage && isEditable;

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), articleSnapshot: '', productNameSnapshot: '', qty: '', expectedPrice: '', attachedFileIds: [] }]);
    setItemsDirty(true);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    setItemsDirty(true);
  }
  function updateRow(key: string, patch: Partial<EditableItemRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setItemsDirty(true);
  }
  function handlePickProduct(key: string, productId: string | undefined, label: string | undefined) {
    const row = rows.find((r) => r.key === key);
    // Attachments are sourced from the LINKED product's own documents — a
    // different product means a different, unrelated document set.
    const patch: Partial<EditableItemRow> = { productId, attachedFileIds: [] };
    if (label) {
      const [article, name] = label.split(' — ');
      if (row && !row.articleSnapshot && article) patch.articleSnapshot = article;
      if (row && !row.productNameSnapshot && name) patch.productNameSnapshot = name;
    }
    updateRow(key, patch);
  }

  async function handleSaveHeader() {
    setError(null);
    if (!supplierNameSnapshot.trim()) {
      setError(t('invalidOrder'));
      return;
    }
    try {
      await updateHeader.mutateAsync({
        supplierId,
        supplierNameSnapshot: supplierNameSnapshot.trim(),
        comment: comment || undefined,
        fromName: fromName.trim() || null,
      });
      setHeaderDirty(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleSaveItems() {
    setError(null);
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
      await saveItems.mutateAsync(items);
      setItemsDirty(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleSend() {
    setError(null);
    try {
      await sendRequest.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  /** "кидати цю заявку постачальнику" — renders the current state to a PDF, stores it (overwriting any previous one), then immediately opens it so staff can download/forward it. */
  async function handleGeneratePdf() {
    setError(null);
    try {
      const updated = await generatePdf.mutateAsync();
      if (updated.pdfFileId) {
        const { downloadUrl } = await getFileDownloadUrl(updated.pdfFileId);
        window.open(downloadUrl, '_blank');
      }
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleCancel() {
    setError(null);
    try {
      await cancelRequest.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConvert() {
    setError(null);
    try {
      const result = await convertToOrder.mutateAsync();
      router.push(`/procurement/${result.purchaseOrder.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteRequest.mutateAsync(params.id);
      router.replace('/procurement/requests');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{request.number}</h2>
          <Badge variant={STATUS_VARIANT[request.status]}>{t(`prStatus${request.status}`)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && request.status === 'DRAFT' && (
            <Button variant="outline" size="sm" loading={sendRequest.isPending} onClick={handleSend}>
              {t('sendRequest')}
            </Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" loading={generatePdf.isPending} onClick={handleGeneratePdf}>
              {t('generatePdf')}
            </Button>
          )}
          {canManage && isEditable && request.status !== 'CANCELLED' && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="default" size="sm">
                  {t('convertToOrder')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('convertToOrderConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('convertToOrderConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={convertToOrder.isPending} onClick={handleConvert}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canManage && isEditable && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {t('cancelRequest')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('cancelRequestConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={cancelRequest.isPending} onClick={handleCancel}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canManage && request.status === 'DRAFT' && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {tc('delete')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('deleteRequestConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={deleteRequest.isPending} onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {request.status === 'CONVERTED' && request.convertedPurchaseOrderId && (
        <p className="text-sm text-muted-foreground">
          {t('convertedToOrderLabel')}{' '}
          <Link href={`/procurement/${request.convertedPurchaseOrderId}`} className="text-primary hover:underline">
            {t('viewOrder')}
          </Link>
        </p>
      )}

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
                setHeaderDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-supplierNameSnapshot">{t('supplier')}</Label>
            <Input
              id="pr-supplierNameSnapshot"
              value={supplierNameSnapshot}
              disabled={!canEdit}
              onChange={(e) => { setSupplierNameSnapshot(e.target.value); setHeaderDirty(true); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-fromName">{t('fromName')}</Label>
            <Input
              id="pr-fromName"
              placeholder={t('fromNamePlaceholder')}
              value={fromName}
              disabled={!canEdit}
              onChange={(e) => { setFromName(e.target.value); setHeaderDirty(true); }}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pr-comment">{t('comment')}</Label>
            <Textarea id="pr-comment" value={comment} disabled={!canEdit} onChange={(e) => { setComment(e.target.value); setHeaderDirty(true); }} />
          </div>
        </CardContent>
        {canEdit && headerDirty && (
          <CardContent className="pt-0">
            <Button size="sm" loading={updateHeader.isPending} onClick={handleSaveHeader}>
              {tc('save')}
            </Button>
          </CardContent>
        )}
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
                {canEdit && <TableHead className="w-10" />}
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
                      {canEdit ? (
                        <ProductPicker value={row.productId} onChange={(id, label) => handlePickProduct(row.key, id, label)} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input value={row.articleSnapshot} onChange={(e) => updateRow(row.key, { articleSnapshot: e.target.value })} />
                      ) : (
                        row.articleSnapshot
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input value={row.productNameSnapshot} onChange={(e) => updateRow(row.key, { productNameSnapshot: e.target.value })} />
                      ) : (
                        row.productNameSnapshot
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" step="any" min={0} value={row.qty} onChange={(e) => updateRow(row.key, { qty: e.target.value })} />
                      ) : (
                        row.qty
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={row.expectedPrice}
                          onChange={(e) => updateRow(row.key, { expectedPrice: e.target.value })}
                        />
                      ) : (
                        row.expectedPrice || '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <ItemFileAttachmentsPicker
                          productId={row.productId}
                          value={row.attachedFileIds}
                          onChange={(ids) => updateRow(row.key, { attachedFileIds: ids })}
                        />
                      ) : (
                        row.attachedFileIds.length > 0 ? t('attachedFilesCount', { count: row.attachedFileIds.length }) : '—'
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                {t('addLine')}
              </Button>
              {itemsDirty && (
                <Button size="sm" loading={saveItems.isPending} onClick={handleSaveItems}>
                  {tc('save')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
