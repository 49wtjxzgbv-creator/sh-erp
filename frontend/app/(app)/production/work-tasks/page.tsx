'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useWorkTasks, useCreateWorkTask } from '@/lib/hooks/use-production-labor';
import { formatEur } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function WorkTasksPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { data, isLoading } = useWorkTasks({});
  const createWorkTask = useCreateWorkTask();
  const canManage = useHasPermission('work-tasks:manage');

  const [title, setTitle] = useState('');
  const [fund, setFund] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const fundValue = Number(fund);
    if (!title.trim() || !fundValue || fundValue < 0) return;
    setCreateError(null);
    try {
      const task = await createWorkTask.mutateAsync({ title: title.trim(), fund: fundValue });
      setTitle('');
      setFund('');
      router.push(`/production/work-tasks/${task.id}`);
    } catch (err) {
      setCreateError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('newWorkTask')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="wtTitle">{t('workTaskTitleLabel')}</Label>
                <Input id="wtTitle" value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wtFund">{t('fundLabel')}</Label>
                <Input id="wtFund" type="number" step="any" min={0} value={fund} onChange={(e) => setFund(e.target.value)} className="w-32" />
              </div>
              <Button type="submit" loading={createWorkTask.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                {tc('create')}
              </Button>
            </form>
            {createError && <p className="mt-2 text-sm text-destructive">{createError}</p>}
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workTaskTitleLabel')}</TableHead>
            <TableHead>{t('fundLabel')}</TableHead>
            <TableHead>{t('executionStatus')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((task) => (
              <TableRow key={task.id} className="cursor-pointer" onClick={() => router.push(`/production/work-tasks/${task.id}`)}>
                <TableCell>{task.title}</TableCell>
                <TableCell>{formatEur(Number(task.fund))}</TableCell>
                <TableCell>
                  <Badge variant={task.status === 'CLOSED' ? 'secondary' : 'success'}>{t(`workTaskStatus${task.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
