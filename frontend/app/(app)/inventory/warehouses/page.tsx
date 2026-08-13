'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, Star } from 'lucide-react';
import { useWarehouses, useCreateWarehouse, useDeleteWarehouse } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export default function WarehousesPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: warehouses, isLoading } = useWarehouses();
  const createWarehouse = useCreateWarehouse();
  const deleteWarehouse = useDeleteWarehouse();

  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      await createWarehouse.mutateAsync({ name: name.trim(), isDefault });
      setName('');
      setIsDefault(false);
    } catch (err) {
      setCreateError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete(id: string) {
    setRowError(null);
    try {
      await deleteWarehouse.mutateAsync(id);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('newWarehouse')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="warehouseName">
                {t('warehouseName')}
              </label>
              <Input id="warehouseName" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {t('isDefault')}
            </label>
            <Button type="submit" loading={createWarehouse.isPending}>
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
            <TableHead>{t('warehouseName')}</TableHead>
            <TableHead className="w-20">{t('isDefault')}</TableHead>
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
          ) : !warehouses || warehouses.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            warehouses.map((warehouse) => (
              <TableRow key={warehouse.id}>
                <TableCell>{warehouse.name}</TableCell>
                <TableCell>{warehouse.isDefault && <Star className="h-4 w-4 text-primary" />}</TableCell>
                <TableCell>
                  <Dialog open={pendingDeleteId === warehouse.id} onOpenChange={(o) => setPendingDeleteId(o ? warehouse.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('deleteWarehouseConfirmTitle')}</DialogTitle>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">{tc('cancel')}</Button>
                        </DialogClose>
                        <Button variant="destructive" loading={deleteWarehouse.isPending} onClick={() => handleDelete(warehouse.id)}>
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
