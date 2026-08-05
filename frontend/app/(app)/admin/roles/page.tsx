'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRoles, useDeleteRole } from '@/lib/hooks/use-roles';
import type { Role } from '@/lib/api-client/roles';
import { RoleFormDialog } from '@/components/domain/admin/role-form-dialog';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';

export default function AdminRolesPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: roles, isLoading } = useRoles();
  const deleteRole = useDeleteRole();

  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function openCreate() {
    setEditingRole(undefined);
    setFormOpen(true);
  }

  function openEdit(role: Role) {
    setEditingRole(role);
    setFormOpen(true);
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteRole.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('rolesDescription')}</p>
        <Button onClick={openCreate}>{t('createRole')}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {roles?.map((role) => (
            <Card key={role.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {role.name}
                    {role.isSystem && <Badge variant="secondary">{t('systemRole')}</Badge>}
                  </CardTitle>
                  {role.description && <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{t('permissionCount', { count: role.permissionKeys.length })}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(role)}>
                    {tc('edit')}
                  </Button>
                  {!role.isSystem &&
                    (confirmingId === role.id ? (
                      <>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(role.id)} loading={deleteRole.isPending}>
                          {tc('confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                          {tc('cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(role.id)}>
                        {tc('delete')}
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RoleFormDialog open={formOpen} onOpenChange={setFormOpen} role={editingRole} />
    </div>
  );
}
