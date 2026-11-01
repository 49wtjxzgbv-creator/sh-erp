'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Scissors } from 'lucide-react';
import { useCuttableProducts, usePreviewCuttingPlan } from '@/lib/hooks/use-cutting';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CuttableProduct } from '@/lib/api-client/cutting';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

/** Per-row "Порахувати розкрій" — a small inline dialog (qty + warehouse), same shape as the one on the product's own cutting card, just in a modal since a table row has no room for an inline form. */
function CalculateDialog({ product }: { product: CuttableProduct }) {
  const t = useTranslations('cutting');
  const tBom = useTranslations('bom');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { data: warehouses } = useWarehouses();
  const preview = usePreviewCuttingPlan();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function handleCalculate() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) return;
    setError(null);
    try {
      const plan = await preview.mutateAsync({ productId: product.productId, qty: qtyNum, warehouseId });
      router.push(`/cutting/${plan.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
          <Scissors className="mr-2 h-4 w-4" />
          {t('calculateCutting')}
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('calculateCuttingDialogTitle')}</DialogTitle>
          <DialogDescription>{t('calculateCuttingDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="list-cutting-qty">{t('calculateCuttingQtyLabel')}</Label>
            <Input id="list-cutting-qty" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-28" />
          </div>
          <div className="space-y-1.5">
            <Label>{tBom('warehouse')}</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={handleCalculate} loading={preview.isPending} disabled={!qty}>
            {t('calculateCutting')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Direct-product cutting (2026-11-01): top-level "Розкрій" section listing
 * every product with a ProductCuttingSpec configured — the second of the
 * two confirmed entry points (the first being the action on the product's
 * own card). Scope is products + draft/executed plan counts, not a full
 * plan-history browser (no generic plan-list endpoint exists).
 */
export default function CuttingListPage() {
  const t = useTranslations('cutting');
  const router = useRouter();
  const canWrite = useHasPermission('cutting:write');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useCuttableProducts({ search: search || undefined, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<CuttableProduct>[]>(
    () => [
      {
        id: 'product',
        header: t('cuttingListColumnProduct'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.product.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.product.article}</div>
          </div>
        ),
      },
      {
        id: 'kind',
        header: t('cuttingListColumnKind'),
        cell: ({ row }) => <Badge variant="outline">{row.original.spec.kind === 'SHEET' ? t('kindSheet') : t('kindBar')}</Badge>,
      },
      {
        id: 'shape',
        header: t('cuttingListColumnShape'),
        cell: ({ row }) =>
          row.original.hasDefaultShape ? (
            <Badge variant="secondary">{t('cuttingListShapeSet')}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{t('cuttingListShapeNotSet')}</span>
          ),
      },
      { id: 'draft', header: t('cuttingListColumnDraft'), cell: ({ row }) => row.original.draftPlanCount },
      { id: 'executed', header: t('cuttingListColumnExecuted'), cell: ({ row }) => row.original.executedPlanCount },
      {
        id: 'lastPlan',
        header: t('cuttingListColumnLastPlan'),
        cell: ({ row }) => (row.original.lastPlanAt ? new Date(row.original.lastPlanAt).toLocaleDateString() : '—'),
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: CuttableProduct } }) =>
                row.original.hasDefaultShape ? <CalculateDialog product={row.original} /> : null,
            } as ColumnDef<CuttableProduct>,
          ]
        : []),
    ],
    [t, canWrite],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('cuttingListTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('cuttingListDescription')}</p>
        </div>
        {canWrite && (
          <Button variant="outline" asChild>
            <Link href="/cutting/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('adHocCreateButton')}
            </Link>
          </Button>
        )}
      </div>

      <Input
        placeholder={t('cuttingListSearchPlaceholder')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(product) => router.push(`/catalog/${product.productId}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
        emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{t('cuttingListEmpty')}</p>}
      />
    </div>
  );
}
