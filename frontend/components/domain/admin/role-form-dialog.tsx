'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateRole, useUpdateRole, usePermissionsCatalogue } from '@/lib/hooks/use-roles';
import type { Role, PermissionDefinition } from '@/lib/api-client/roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined = create mode. */
  role?: Role;
}

/** Shared by "create role" and "edit role" — permissions are grouped by resource so the checkbox list reads as a real permission matrix, not 30 flat checkboxes. */
export function RoleFormDialog({ open, onOpenChange, role }: RoleFormDialogProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: catalogue } = usePermissionsCatalogue();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.permissionKeys ?? []));
    setError(null);
  }, [open, role]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const grouped = new Map<string, PermissionDefinition[]>();
  for (const p of catalogue ?? []) {
    const list = grouped.get(p.resource) ?? [];
    list.push(p);
    grouped.set(p.resource, list);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    try {
      const dto = { name: name.trim(), description: description || undefined, permissionKeys: Array.from(selected) };
      if (role) {
        await updateRole.mutateAsync({ id: role.id, dto });
      } else {
        await createRole.mutateAsync(dto);
      }
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const pending = createRole.isPending || updateRole.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? t('editRole') : t('createRole')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="role-name">{t('roleName')}</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">{t('roleDescription')}</Label>
            <Textarea id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-3">
            <Label>{t('permissions')}</Label>
            {Array.from(grouped.entries()).map(([resource, perms]) => (
              <div key={resource} className="space-y-1.5 rounded-md border border-border p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">{resource}</p>
                {perms.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-input"
                      checked={selected.has(p.key)}
                      onChange={() => toggle(p.key)}
                    />
                    <span>
                      <span className="font-mono text-xs">{p.key}</span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
