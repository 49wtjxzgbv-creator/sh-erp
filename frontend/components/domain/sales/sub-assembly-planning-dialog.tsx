'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSubAssembliesNeeded } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { SubAssemblyToProduceInput } from '@/lib/api-client/sales';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';

interface Row {
  assemblyId: string;
  name: string;
  article: string | null;
  qtyNeeded: number;
  qtyInStock: number;
  produce: boolean;
  qty: string;
}

export interface SubAssemblyPlanningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assemblyId: string | undefined;
  qty: number;
  /** Re-applied onto the fetched list when reopening for the same row, so edits aren't lost. */
  initialDecisions?: SubAssemblyToProduceInput[];
  onConfirm: (decisions: SubAssemblyToProduceInput[]) => void;
}

/**
 * "Чи додаємо ці підвироби в замовлення" (2026-08-25 user request): opened
 * automatically when a sales-order line's assembly has sub-assemblies
 * (recursively, at any BOM depth). Per distinct sub-assembly, the user
 * picks "Виготовити" (plans a PLANNED ProductionOrder batch now, linked
 * via subAssemblyForItemId once the order is created) or "Зі складу" (do
 * nothing — same as today's implicit default, consumed from whatever's
 * IN_STOCK once the parent assembly is actually started).
 */
export function SubAssemblyPlanningDialog({ open, onOpenChange, assemblyId, qty, initialDecisions, onConfirm }: SubAssemblyPlanningDialogProps) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const needed = useSubAssembliesNeeded();
  const [rows, setRows] = useState<Row[]>([]);

  const assemblyIds = rows.map((r) => r.assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  useEffect(() => {
    if (!open || !assemblyId || !qty) return;
    needed.mutate(
      { assemblyId, qty },
      {
        onSuccess: (list) => {
          const initialByAssembly = new Map((initialDecisions ?? []).map((d) => [d.assemblyId, d.qty]));
          setRows(
            list.map((line) => {
              const preset = initialByAssembly.get(line.assemblyId);
              const shortfall = Math.max(0, Math.ceil(line.qtyNeeded - line.qtyInStock));
              return {
                assemblyId: line.assemblyId,
                name: line.name,
                article: line.article,
                qtyNeeded: line.qtyNeeded,
                qtyInStock: line.qtyInStock,
                produce: preset !== undefined ? true : shortfall > 0,
                qty: String(preset ?? (shortfall > 0 ? shortfall : Math.ceil(line.qtyNeeded))),
              };
            }),
          );
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the dialog opens for a (possibly new) assembly/qty pair, not on every needed.mutate identity change
  }, [open, assemblyId, qty]);

  function updateRow(assemblyId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.assemblyId === assemblyId ? { ...r, ...patch } : r)));
  }

  function handleConfirm() {
    const decisions: SubAssemblyToProduceInput[] = rows
      .filter((r) => r.produce && Number(r.qty) > 0)
      .map((r) => ({ assemblyId: r.assemblyId, qty: Math.ceil(Number(r.qty)) }));
    onConfirm(decisions);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('subAssemblyPlanningTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('subAssemblyPlanningDescription')}</p>
          {needed.isPending && <p className="text-sm text-muted-foreground">{tc('loading')}</p>}
          {rows.map((row) => (
            <div key={row.assemblyId} className="flex items-center gap-3 rounded-md border border-border p-3">
              <Avatar src={photosByAssembly?.[row.assemblyId]?.[0]?.downloadUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.article ? `${row.article} — ${row.name}` : row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('subAssemblyNeeded', { qty: row.qtyNeeded })} · {t('subAssemblyInStock', { qty: row.qtyInStock })}
                  {row.qtyInStock >= row.qtyNeeded && (
                    <Badge variant="success" className="ml-2">
                      {t('subAssemblySufficient')}
                    </Badge>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={row.produce ? 'default' : 'outline'}
                  onClick={() => updateRow(row.assemblyId, { produce: true })}
                >
                  {t('subAssemblyProduce')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!row.produce ? 'default' : 'outline'}
                  onClick={() => updateRow(row.assemblyId, { produce: false })}
                >
                  {t('subAssemblyFromStock')}
                </Button>
                {row.produce && (
                  <Input
                    type="number"
                    step="1"
                    min={1}
                    value={row.qty}
                    onChange={(e) => updateRow(row.assemblyId, { qty: e.target.value })}
                    className="w-20"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          <Button onClick={handleConfirm}>{tc('confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
