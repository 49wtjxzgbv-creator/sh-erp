'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useQcChecklistItems, useCreateQcChecklistItem, useDeleteQcChecklistItem } from '@/lib/hooks/use-production';
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

export default function QcChecklistPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const { data: items, isLoading } = useQcChecklistItems();
  const createItem = useCreateQcChecklistItem();
  const deleteItem = useDeleteQcChecklistItem();

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      await createItem.mutateAsync(name.trim());
      setName('');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete(id: string) {
    setRowError(null);
    try {
      await deleteItem.mutateAsync(id);
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
          <CardTitle className="text-base">{t('newChecklistItem')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="itemName">
                {t('checklistItemName')}
              </label>
              <Input id="itemName" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            </div>
            <Button type="submit" loading={createItem.isPending}>
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
            <TableHead>{t('checklistItemName')}</TableHead>
            <TableHead className="w-16">{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !items || items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>
                  <Dialog open={pendingDeleteId === item.id} onOpenChange={(o) => setPendingDeleteId(o ? item.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('deleteChecklistItemConfirmTitle')}</DialogTitle>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">{tc('cancel')}</Button>
                        </DialogClose>
                        <Button variant="destructive" loading={deleteItem.isPending} onClick={() => handleDelete(item.id)}>
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
