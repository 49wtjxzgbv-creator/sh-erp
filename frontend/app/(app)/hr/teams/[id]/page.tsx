'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useTeam, useUpdateTeam, useSetTeamMembers, useDeleteTeam } from '@/lib/hooks/use-hr';
import { EmployeePicker } from '@/components/domain/hr/employee-picker';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface MemberRow {
  key: string;
  employeeId?: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `member-row-${rowKeySeq}`;
}

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const canManage = useHasPermission('teams:manage');

  const { data: team, isLoading } = useTeam(params.id);
  const updateTeam = useUpdateTeam(params.id);
  const setMembers = useSetTeamMembers(params.id);
  const deleteTeam = useDeleteTeam();

  const [name, setName] = useState('');
  const [rows, setRows] = useState<MemberRow[]>([]);
  const hydrated = useRef(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (team && !hydrated.current) {
      hydrated.current = true;
      setName(team.name);
      setRows((team.members ?? []).map((m) => ({ key: newRowKey(), employeeId: m.employeeId })));
    }
  }, [team]);

  if (isLoading || !team) return <LoadingBlock />;

  function addRow() {
    setRows((r) => [...r, { key: newRowKey() }]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }
  function updateRow(key: string, employeeId: string | undefined) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, employeeId } : row)));
  }

  async function handleSaveName() {
    setNameError(null);
    if (!name.trim()) return;
    try {
      await updateTeam.mutateAsync(name.trim());
    } catch (err) {
      setNameError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleSaveMembers() {
    setMembersError(null);
    const ids = rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id));
    try {
      await setMembers.mutateAsync(ids);
    } catch (err) {
      setMembersError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    try {
      await deleteTeam.mutateAsync(params.id);
      router.replace('/hr/teams');
    } catch (err) {
      setMembersError(apiErrorMessage(err, tc('error')));
      setDeleteOpen(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{team.name}</h2>
        {canManage && (
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                {tc('delete')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('deleteTeamConfirmTitle')}</DialogTitle>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{tc('cancel')}</Button>
                </DialogClose>
                <Button variant="destructive" loading={deleteTeam.isPending} onClick={handleDelete}>
                  {tc('delete')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('teamNameLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset disabled={!canManage} className="contents">
            <div className="space-y-1.5">
              <Label>{t('teamNameLabel')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
            </div>
          </fieldset>
          {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          {canManage && (
            <Button variant="outline" onClick={handleSaveName} loading={updateTeam.isPending}>
              {tc('save')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('teamMembersLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('teamMembersHint')}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employee')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <EmployeePicker value={row.employeeId} onChange={(id) => updateRow(row.key, id)} />
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                {t('teamMembersLabel')}
              </Button>
              <Button variant="outline" onClick={handleSaveMembers} loading={setMembers.isPending}>
                {tc('save')}
              </Button>
            </div>
          )}
          {membersError && <p className="text-sm text-destructive">{membersError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
