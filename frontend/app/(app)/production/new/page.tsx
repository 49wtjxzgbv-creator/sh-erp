'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateProductionOrder } from '@/lib/hooks/use-production';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { WorkerEditor, rowsToWorkers, type EditableWorkerRow } from '@/components/domain/production/worker-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/domain/auth/require-permission';

export default function NewProductionOrderPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createOrder = useCreateProductionOrder();

  const [assemblyId, setAssemblyId] = useState<string | undefined>(undefined);
  const [unitsPlanned, setUnitsPlanned] = useState('');
  const [comment, setComment] = useState('');
  const [workerRows, setWorkerRows] = useState<EditableWorkerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const units = Number(unitsPlanned);
    if (!assemblyId || !units || units <= 0 || !Number.isInteger(units)) {
      setError(t('invalidOrder'));
      return;
    }
    const workers = workerRows.length > 0 ? rowsToWorkers(workerRows) : [];
    if (workers === null) {
      setError(t('invalidRow'));
      return;
    }
    try {
      const order = await createOrder.mutateAsync({
        assemblyId,
        unitsPlanned: units,
        comment: comment || undefined,
        workers: workers.length > 0 ? workers : undefined,
      });
      router.replace(`/production/${order.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="production-orders:manage" redirectTo="/production">
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newOrder')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('orderHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('assembly')}</Label>
            <AssemblyPicker value={assemblyId} onChange={(id) => setAssemblyId(id)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unitsPlanned">{t('unitsPlanned')}</Label>
            <Input
              id="unitsPlanned"
              type="number"
              step="1"
              min={1}
              value={unitsPlanned}
              onChange={(e) => setUnitsPlanned(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('workers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkerEditor rows={workerRows} onChange={setWorkerRows} />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} loading={createOrder.isPending}>
        {tc('create')}
      </Button>
    </div>
    </RequirePermission>
  );
}
