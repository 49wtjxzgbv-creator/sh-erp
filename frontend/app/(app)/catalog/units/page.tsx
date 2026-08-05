'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Plus } from 'lucide-react';
import { useCompanyUnits, useCreateCompanyUnit, useDeleteCompanyUnit } from '@/lib/hooks/use-catalog';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function CompanyUnitsPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { data: units, isLoading } = useCompanyUnits();
  const createUnit = useCreateCompanyUnit();
  const deleteUnit = useDeleteCompanyUnit();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await createUnit.mutateAsync({ name: name.trim() });
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteUnit.mutateAsync(id);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">{t('units')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('addUnit')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" onSubmit={handleCreate}>
            <Input
              placeholder={t('unitName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-xs"
            />
            <Button type="submit" loading={createUnit.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              {tc('create')}
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('unitName')}</TableHead>
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
          ) : !units || units.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            units.map((unit) => (
              <TableRow key={unit.id}>
                <TableCell>{unit.name}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleteUnit.isPending}
                    onClick={() => handleDelete(unit.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
    </div>
  );
}
