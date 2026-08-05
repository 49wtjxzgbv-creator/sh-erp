'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useProductionStages, useCreateProductionStage, useReorderProductionStages, useDeleteProductionStage } from '@/lib/hooks/use-production';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

/**
 * No drag-and-drop library is in this project's dependency set (see
 * bom-editor.tsx / warehouses page for the same constraint), so reordering
 * is done via up/down buttons that submit the full reordered id array to
 * PUT /production-stages/reorder — same "full array rewrite" contract as
 * the backend's ReorderProductionStagesDto.
 */
export default function ProductionStagesPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const { data: stages, isLoading } = useProductionStages();
  const createStage = useCreateProductionStage();
  const reorderStages = useReorderProductionStages();
  const deleteStage = useDeleteProductionStage();

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      await createStage.mutateAsync(name.trim());
      setName('');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!stages) return;
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setRowError(null);
    try {
      await reorderStages.mutateAsync(ids);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete(id: string) {
    setRowError(null);
    try {
      await deleteStage.mutateAsync(id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : tc('error'));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('newStage')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="stageName">
                {t('stageName')}
              </label>
              <Input id="stageName" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            </div>
            <Button type="submit" loading={createStage.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              {tc('create')}
            </Button>
          </form>
          {createError && <p className="mt-2 text-sm text-destructive">{createError}</p>}
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('stageName')}</TableHead>
            <TableHead className="w-24">{t('order')}</TableHead>
            <TableHead className="w-16">{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !stages || stages.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            stages.map((stage, idx) => (
              <TableRow key={stage.id}>
                <TableCell>{stage.name}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" disabled={idx === 0} onClick={() => handleMove(idx, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={idx === stages.length - 1} onClick={() => handleMove(idx, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Dialog open={pendingDeleteId === stage.id} onOpenChange={(o) => setPendingDeleteId(o ? stage.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('deleteStageConfirmTitle')}</DialogTitle>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">{tc('cancel')}</Button>
                        </DialogClose>
                        <Button variant="destructive" loading={deleteStage.isPending} onClick={() => handleDelete(stage.id)}>
                          {tc('delete')}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {rowError && <p className="text-sm text-destructive">{rowError}</p>}
    </div>
  );
}
