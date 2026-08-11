'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { superAdminApi } from '@/lib/super-admin/api';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
  createdAt: string;
  subscription?: { plan?: { key: string } } | null;
}

export default function SuperAdminCompaniesPage() {
  const t = useTranslations('superAdmin');
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    </div>
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
