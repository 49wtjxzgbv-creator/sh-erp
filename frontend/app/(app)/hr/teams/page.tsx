'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useTeams, useCreateTeam } from '@/lib/hooks/use-hr';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function TeamsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { data, isLoading } = useTeams({});
  const createTeam = useCreateTeam();
  const canManage = useHasPermission('teams:manage');

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      const team = await createTeam.mutateAsync(name.trim());
      setName('');
      router.push(`/hr/teams/${team.id}`);
    } catch (err) {
      setCreateError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('newTeam')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground" htmlFor="teamName">
                  {t('teamNameLabel')}
                </label>
                <Input id="teamName" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
              </div>
              <Button type="submit" loading={createTeam.isPending}>
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
            <TableHead>{t('teamNameLabel')}</TableHead>
            <TableHead>{t('teamMembersLabel')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((team) => (
              <TableRow key={team.id} className="cursor-pointer" onClick={() => router.push(`/hr/teams/${team.id}`)}>
                <TableCell>{team.name}</TableCell>
                <TableCell>{team.members?.length ?? 0}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
