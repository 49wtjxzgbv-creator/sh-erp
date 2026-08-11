'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/domain/shell/confirm-dialog';
import { superAdminApi } from '@/lib/super-admin/api';

interface PlanRow {
  id: string;
  key: string;
  name: string;
  monthlyPriceEur: string;
  limits: Record<string, unknown>;
}

export default function SuperAdminPlansPage() {
  const t = useTranslations('superAdmin');
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [form, setForm] = useState({ key: '', name: '', monthlyPriceEur: '', limitsJson: '{}' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);

  const load = useCallback(async () => {
    const res = await superAdminApi.get<PlanRow[]>('super-admin/plans');
    setPlans(res);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function edit(plan: PlanRow) {
    setForm({
      key: plan.key,
      name: plan.name,
      monthlyPriceEur: String(plan.monthlyPriceEur),
      limitsJson: JSON.stringify(plan.limits, null, 2),
    });
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setBusyId(deleteTarget.id);
    try {
      await superAdminApi.delete(`super-admin/plans/${deleteTarget.id}`);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('deletePlanFailed'));
    } finally {
      setDeleteTarget(null);
      setBusyId(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let limits: Record<string, unknown>;
      try {
        limits = JSON.parse(form.limitsJson);
      } catch {
        throw new Error('Limits must be valid JSON, e.g. {"maxUsers": 15, "maxProducts": 5000}');
      }
      await superAdminApi.post('super-admin/plans', {
        key: form.key,
        name: form.name,
        monthlyPriceEur: Number(form.monthlyPriceEur),
        limits,
      });
      setForm({ key: '', name: '', monthlyPriceEur: '', limitsJson: '{}' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('plansHeading')}</h1>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('createOrUpdatePlan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('key')}</Label>
              <Input required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('name')}</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('monthlyPrice')}</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={form.monthlyPriceEur}
                onChange={(e) => setForm({ ...form, monthlyPriceEur: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('limitsJson')}</Label>
              <Input value={form.limitsJson} onChange={(e) => setForm({ ...form, limitsJson: e.target.value })} />
            </div>
            {error && <p className="text-sm text-red-400 md:col-span-2">{error}</p>}
            <div className="md:col-span-2">
              <Button type="submit" loading={loading}>
                {t('savePlan')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('existingPlans')}</CardTitle>
          {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('key')}</TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('pricePerMonth')}</TableHead>
                <TableHead>{t('limits')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.key}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>€{p.monthlyPriceEur}</TableCell>
                  <TableCell className="text-slate-400">{JSON.stringify(p.limits)}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => edit(p)}>
                      {t('edit')}
                    </Button>
                    <Button size="sm" variant="destructive" loading={busyId === p.id} onClick={() => setDeleteTarget(p)}>
                      {t('deletePlan')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('deletePlan')}
        description={deleteTarget ? t('deletePlanConfirm', { name: deleteTarget.name }) : ''}
        onConfirm={onDelete}
        confirmLabel={t('deletePlan')}
        confirming={Boolean(busyId)}
      />
    </div>
  );
}
