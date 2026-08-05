'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInviteUser } from '@/lib/hooks/use-users';
import { useRoles } from '@/lib/hooks/use-roles';
import { ApiError } from '@/lib/api-client/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shows the generated temporary password exactly once after a successful
 * invite of a brand-new email — matches the backend contract documented in
 * lib/api-client/users.ts: this is the only time it's ever retrievable.
 */
export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: roles } = useRoles();
  const inviteUser = useInviteUser();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; tempPassword: string | null } | null>(null);

  function reset() {
    setEmail('');
    setFullName('');
    setRoleId(undefined);
    setError(null);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !fullName || !roleId) return;
    try {
      const res = await inviteUser.mutateAsync({ email, fullName, roleId });
      setResult({ email: res.email, tempPassword: res.tempPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inviteUser')}</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            {result.tempPassword ? (
              <div className="space-y-2 rounded-md border border-warning bg-warning/10 p-3 text-sm">
                <p>{t('inviteSuccessNewAccount', { email: result.email })}</p>
                <p className="font-mono text-base font-semibold">{result.tempPassword}</p>
                <p className="text-xs text-muted-foreground">{t('tempPasswordWarning')}</p>
              </div>
            ) : (
              <p className="text-sm text-success">{t('inviteSuccessExistingAccount', { email: result.email })}</p>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t('email')}</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-fullName">{t('fullName')}</Label>
              <Input id="invite-fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('role')}</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('role')} />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" loading={inviteUser.isPending} disabled={!email || !fullName || !roleId}>
                {t('inviteUser')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
