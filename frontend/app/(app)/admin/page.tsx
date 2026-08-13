'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUsers, useUpdateUserRole, useDeactivateUser } from '@/lib/hooks/use-users';
import { useRoles } from '@/lib/hooks/use-roles';
import { useSessionStore } from '@/lib/auth/session-store';
import { InviteUserDialog } from '@/components/domain/admin/invite-user-dialog';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/loading-block';

export default function AdminUsersPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const currentUserId = useSessionStore((s) => s.userId);
  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const updateRole = useUpdateUserRole();
  const deactivate = useDeactivateUser();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUserId, setConfirmingUserId] = useState<string | null>(null);

  async function handleRoleChange(userId: string, roleId: string) {
    setError(null);
    try {
      await updateRole.mutateAsync({ userId, roleId });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDeactivate(userId: string) {
    setError(null);
    try {
      await deactivate.mutateAsync(userId);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setConfirmingUserId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('usersDescription')}</p>
        <Button onClick={() => setInviteOpen(true)}>{t('inviteUser')}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fullName')}</TableHead>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{tc('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map((u) => {
              const isSelf = u.userId === currentUserId;
              return (
                <TableRow key={u.userId}>
                  <TableCell>
                    {u.fullName} {isSelf && <Badge variant="outline">{t('you')}</Badge>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Select value={u.roleId} onValueChange={(v) => handleRoleChange(u.userId, v)}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {isSelf ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : confirmingUserId === u.userId ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={() => handleDeactivate(u.userId)} loading={deactivate.isPending}>
                          {tc('confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingUserId(null)}>
                          {tc('cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmingUserId(u.userId)}>
                        {t('removeAccess')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
