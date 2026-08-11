'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { superAdminApi } from '@/lib/super-admin/api';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
  createdAt: string;
  subscription?: { plan?: { key: string } } | null;
}

interface CompanyDetail extends CompanyRow {
  subscription?: { status: string; plan?: { key: string; name: string } } | null;
  memberships: {
    userId: string;
    roleId: string;
    user: { id: string; email: string; fullName: string };
    role: { id: string; name: string };
  }[];
}

export default function SuperAdminCompaniesPage() {
  const t = useTranslations('superAdmin');
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await superAdminApi.get<{ items: CompanyRow[] }>(
        `super-admin/companies${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      );
      setCompanies(res.items);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function block(id: string) {
    setBusyId(id);
    try {
      await superAdminApi.post(`super-admin/companies/${id}/block`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unblock(id: string) {
    setBusyId(id);
    try {
      await superAdminApi.post(`super-admin/companies/${id}/unblock`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function impersonate(id: string) {
    setBusyId(id);
    try {
      const res = await superAdminApi.post<{
        accessToken: string;
        userId: string;
        companyId: string;
        companySlug: string;
        roleId: string;
      }>(`super-admin/companies/${id}/impersonate`, {});
      const params = new URLSearchParams({
        accessToken: res.accessToken,
        userId: res.userId,
        companyId: res.companyId,
        companySlug: res.companySlug,
        roleId: res.roleId,
      });
      // New tab — the Super Admin panel session stays open in this one.
      window.open(`/impersonate?${params.toString()}`, '_blank');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('companiesHeading')}</h1>
        <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? t('cancel') : t('createCompany')}</Button>
      </div>

      {showCreate && (
        <CreateCompanyForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('allCompanies')}</CardTitle>
          <div className="pt-2">
            <Input
              placeholder={t('searchCompanies')}
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
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('slug')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('plan')}</TableHead>
                <TableHead>{t('created')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-slate-400">{c.slug}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'ACTIVE' ? 'default' : 'destructive'}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>{c.subscription?.plan?.key ?? '—'}</TableCell>
                  <TableCell className="text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDetailId(c.id)}>
                      {t('details')}
                    </Button>
                    <Button size="sm" variant="outline" loading={busyId === c.id} onClick={() => impersonate(c.id)}>
                      {t('impersonate')}
                    </Button>
                    {c.status === 'ACTIVE' ? (
                      <Button size="sm" variant="destructive" loading={busyId === c.id} onClick={() => block(c.id)}>
                        {t('block')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" loading={busyId === c.id} onClick={() => unblock(c.id)}>
                        {t('unblock')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {t('noCompaniesFound')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CompanyDetailDialog
        companyId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={load}
      />
    </div>
  );
}

function CompanyDetailDialog({
  companyId,
  onClose,
  onChanged,
}: {
  companyId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('superAdmin');
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    const res = await superAdminApi.get<CompanyDetail>(`super-admin/companies/${companyId}`);
    setCompany(res);
    setName(res.name);
    setSlug(res.slug);
  }, [companyId]);

  useEffect(() => {
    setSaveError(null);
    setRemoveError(null);
    load();
  }, [load]);

  async function save() {
    if (!companyId) return;
    setSaveError(null);
    setSaving(true);
    try {
      await superAdminApi.patch(`super-admin/companies/${companyId}`, { name, slug });
      await load();
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(userId: string, email: string) {
    if (!companyId) return;
    if (!window.confirm(t('removeMemberConfirm', { email }))) return;
    setRemoveError(null);
    setRemovingUserId(userId);
    try {
      await superAdminApi.delete(`super-admin/companies/${companyId}/members/${userId}`);
      await load();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : t('removeMemberFailed'));
    } finally {
      setRemovingUserId(null);
    }
  }

  return (
    <Dialog open={Boolean(companyId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle>{t('companyDetailTitle')}</DialogTitle>
        </DialogHeader>

        {company && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-slate-950" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('slug')}</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="bg-slate-950" />
              </div>
              {saveError && <p className="text-sm text-red-400 sm:col-span-2">{saveError}</p>}
              <div className="sm:col-span-2">
                <Button type="button" size="sm" loading={saving} onClick={save}>
                  {t('saveChanges')}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 text-sm text-slate-300">
              <p className="font-medium text-slate-100">{t('subscription')}</p>
              <p>
                {t('plan')}: {company.subscription?.plan?.name ?? '—'} · {t('subscriptionStatus')}:{' '}
                {company.subscription?.status ?? '—'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-100">{t('members')}</p>
              {removeError && <p className="text-sm text-red-400">{removeError}</p>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('email')}</TableHead>
                    <TableHead>{t('role')}</TableHead>
                    <TableHead className="text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.memberships.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>{m.user.email}</TableCell>
                      <TableCell className="text-slate-400">{m.role.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={removingUserId === m.userId}
                          onClick={() => removeMember(m.userId, m.user.email)}
                        >
                          {t('removeMember')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {company.memberships.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500">
                        {t('noMembers')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCompanyForm({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('superAdmin');
  const [form, setForm] = useState({
    companyName: '',
    slug: '',
    ownerEmail: '',
    ownerPassword: '',
    ownerFullName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await superAdminApi.post('super-admin/companies', form);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="text-base">{t('createCompanyManually')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('companyName')}</Label>
            <Input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('slug')}</Label>
            <Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('ownerEmail')}</Label>
            <Input
              type="email"
              required
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('ownerPassword')}</Label>
            <Input
              type="password"
              required
              minLength={12}
              value={form.ownerPassword}
              onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>{t('ownerFullName')}</Label>
            <Input
              required
              value={form.ownerFullName}
              onChange={(e) => setForm({ ...form, ownerFullName: e.target.value })}
            />
          </div>
          {error && <p className="text-sm text-red-400 md:col-span-2">{error}</p>}
          <div className="md:col-span-2">
            <Button type="submit" loading={loading}>
              {t('create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
