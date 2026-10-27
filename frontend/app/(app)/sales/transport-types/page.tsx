'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useTransportUnitTypes, useCreateTransportUnitType, useDeleteTransportUnitType } from '@/lib/hooks/use-logistics';
import { toNumber } from '@/lib/api-client/decimal';
import { useApiErrorMessage } from '@/lib/api-error-message';
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
import { RequirePermission } from '@/components/domain/auth/require-permission';

export default function TransportTypesPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: types, isLoading } = useTransportUnitTypes();
  const createType = useCreateTransportUnitType();
  const deleteType = useDeleteTransportUnitType();

  const [name, setName] = useState('');
  const [maxWeightKg, setMaxWeightKg] = useState('');
  const [maxVolumeM3, setMaxVolumeM3] = useState('');
  const [maxPackages, setMaxPackages] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !maxWeightKg) return;
    setCreateError(null);
    try {
      await createType.mutateAsync({
        name: name.trim(),
        maxWeightKg: Number(maxWeightKg),
        maxVolumeM3: maxVolumeM3 ? Number(maxVolumeM3) : undefined,
        maxPackages: maxPackages ? Number(maxPackages) : undefined,
      });
      setName('');
      setMaxWeightKg('');
      setMaxVolumeM3('');
      setMaxPackages('');
    } catch (err) {
      setCreateError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete(id: string) {
    setRowError(null);
    try {
      await deleteType.mutateAsync(id);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <RequirePermission permission="transport-unit-types:manage" redirectTo="/sales">
      <div className="max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('newTransportType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground" htmlFor="transportTypeName">
                  {t('transportTypeName')}
                </label>
                <Input id="transportTypeName" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground" htmlFor="transportTypeMaxWeight">
                  {t('transportTypeMaxWeight')}
                </label>
                <Input
                  id="transportTypeMaxWeight"
                  type="number"
                  step="any"
                  min="0"
                  value={maxWeightKg}
                  onChange={(e) => setMaxWeightKg(e.target.value)}
                  className="max-w-[9rem]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground" htmlFor="transportTypeMaxVolume">
                  {t('transportTypeMaxVolume')}
                </label>
                <Input
                  id="transportTypeMaxVolume"
                  type="number"
                  step="any"
                  min="0"
                  value={maxVolumeM3}
                  onChange={(e) => setMaxVolumeM3(e.target.value)}
                  className="max-w-[9rem]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground" htmlFor="transportTypeMaxPackages">
                  {t('transportTypeMaxPackages')}
                </label>
                <Input
                  id="transportTypeMaxPackages"
                  type="number"
                  step="1"
                  min="0"
                  value={maxPackages}
                  onChange={(e) => setMaxPackages(e.target.value)}
                  className="max-w-[9rem]"
                />
              </div>
              <Button type="submit" loading={createType.isPending}>
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
              <TableHead>{t('transportTypeName')}</TableHead>
              <TableHead className="w-28">{t('transportTypeMaxWeight')}</TableHead>
              <TableHead className="w-28">{t('transportTypeMaxVolume')}</TableHead>
              <TableHead className="w-28">{t('transportTypeMaxPackages')}</TableHead>
              <TableHead className="w-16">{tc('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {tc('loading')}
                </TableCell>
              </TableRow>
            ) : !types || types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {tc('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              types.map((type) => (
                <TableRow key={type.id}>
                  <TableCell>{type.name}</TableCell>
                  <TableCell>{toNumber(type.maxWeightKg)}</TableCell>
                  <TableCell>{toNumber(type.maxVolumeM3) ?? '—'}</TableCell>
                  <TableCell>{type.maxPackages ?? '—'}</TableCell>
                  <TableCell>
                    <Dialog open={pendingDeleteId === type.id} onOpenChange={(o) => setPendingDeleteId(o ? type.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t('deleteTransportTypeConfirmTitle')}</DialogTitle>
                        </DialogHeader>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="outline">{tc('cancel')}</Button>
                          </DialogClose>
                          <Button variant="destructive" loading={deleteType.isPending} onClick={() => handleDelete(type.id)}>
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
    </RequirePermission>
  );
}
