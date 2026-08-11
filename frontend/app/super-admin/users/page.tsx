'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { superAdminApi } from '@/lib/super-admin/api';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  createdAt: string;
  memberships: { companyId: string; company: { name: string; slug: string } }[];
}

export default function SuperAdminUsersPage() {
  const t = useTranslations('superAdmin');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    const res = await superAdminApi.get<{ items: UserRow[] }>(
      `super-admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    );
    setUsers(res.items);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(user: UserRow) {
    setBusyId(user.id);
    try {
      await superAdminApi.post(`super-admin/users/${user.id}/${user.active ? 'block' : 'unblock'}`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('usersHeading')}</h1>
      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('everyUser')}</CardTitle>
          <div className="pt-2">
            <Input
              placeholder={t('searchUsers')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs bg-slate-950"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('fullName')}</TableHead>
                <TableHead>{t('companies')}</TableHead>
                <TableHead>{t('active')}</TableHead>
                <TableHead>{t('created')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.fullName}</TableCell>
                  <TableCell className="text-slate-400">
                    {u.memberships.map((m) => m.company.name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? 'default' : 'destructive'}>{u.active ? t('yes') : t('no')}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setResetTarget(u)}>
                      {t('resetPassword')}
                    </Button>
                    <Button
                      size="sm"
                      variant={u.active ? 'destructive' : 'secondary'}
                      loading={busyId === u.id}
                      onClick={() => toggleActive(u)}
                    >
                      {u.active ? t('block') : t('unblock')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {t('noUsersFound')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const t = useTranslations('superAdmin');
  const [customPassword, setCustomPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-seed on open so a previous target's leftover state never leaks into a new one.
  useEffect(() => {
    if (user) {
      setCustomPassword('');
      setError(null);
      setResult(null);
      setCopied(false);
    }
  }, [user]);

  async function submit(newPassword?: string) {
    if (!user) return;
    setError(null);
    setLoading(true);
    try {
      const res = await superAdminApi.post<{ newPassword: string }>(`super-admin/users/${user.id}/reset-password`, {
        newPassword: newPassword || undefined,
      });
      setResult(res.newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('resetFailed'));
    } finally {
      setLoading(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) onClose();
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={handleClose}>
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle>{t('resetPasswordDialogTitle')}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {t('resetPasswordDialogDescription', { email: user?.email ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-300">{t('newPasswordGenerated')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                {result}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(result);
                  setCopied(true);
                }}
              >
                {copied ? t('copied') : t('copyPassword')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                {t('newPasswordLabel')} ({t('orTypeCustom')})
              </Label>
              <Input
                type="text"
                minLength={8}
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                className="bg-slate-950"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('close')}
              </Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              </DialogClose>
              {customPassword ? (
                <Button type="button" loading={loading} onClick={() => submit(customPassword)}>
                  {t('confirm')}
                </Button>
              ) : (
                <Button type="button" loading={loading} onClick={() => submit()}>
                  {t('generateRandom')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
