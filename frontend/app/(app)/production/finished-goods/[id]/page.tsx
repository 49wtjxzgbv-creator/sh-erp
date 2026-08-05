'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useFinishedGood,
  useQcChecklistItems,
  useQcChecksForFinishedGood,
  useRecordQcCheck,
} from '@/lib/hooks/use-production';
import { ApiError } from '@/lib/api-client/types';
import type { QcResult, QcCheckResultLine, FinishedGoodStatus } from '@/lib/api-client/production';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const FG_STATUS_VARIANT: Record<FinishedGoodStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  IN_STOCK: 'success',
  SHIPPED: 'secondary',
  CONSUMED: 'secondary',
  REWORK: 'warning',
  DEFECTIVE: 'destructive',
};

export default function FinishedGoodDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('production');
  const tc = useTranslations('common');

  const { data: fg, isLoading } = useFinishedGood(params.id);
  const { data: checklistItems } = useQcChecklistItems();
  const { data: qcChecks } = useQcChecksForFinishedGood(params.id);
  const recordCheck = useRecordQcCheck();

  const [passedMap, setPassedMap] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<QcResult>('ACCEPTED');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (checklistItems) {
      setPassedMap((prev) => {
        const next = { ...prev };
        for (const item of checklistItems) {
          if (!(item.name in next)) next[item.name] = true;
        }
        return next;
      });
    }
  }, [checklistItems]);

  if (isLoading || !fg) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  async function handleSubmit() {
    if (!fg) return;
    setError(null);
    setSuccess(false);
    const results: QcCheckResultLine[] = (checklistItems ?? []).map((item) => ({
      itemName: item.name,
      passed: passedMap[item.name] ?? true,
    }));
    try {
      await recordCheck.mutateAsync({
        finishedGoodId: fg.id,
        result,
        comment: comment || undefined,
        results: results.length > 0 ? results : undefined,
      });
      setSuccess(true);
      setComment('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{fg.serialNumber}</h1>
        <Badge variant={FG_STATUS_VARIANT[fg.status]}>{t(`fgStatus${fg.status}`)}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('assembly')}</p>
            <p className="max-w-[200px] truncate text-sm" title={fg.assemblyId}>{fg.assemblyId}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('manufactureDate')}</p>
            <p className="text-sm">{new Date(fg.manufactureDate).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('productionOrder')}</p>
            <p className="max-w-[200px] truncate text-sm" title={fg.productionOrderId}>{fg.productionOrderId}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('localCost')}</p>
            <p className="text-sm">{fg.unitCostLocalEur}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('germanCost')}</p>
            <p className="text-sm">{fg.unitCostGermanEur}</p>
          </div>
          {fg.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{fg.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('recordQcCheck')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {checklistItems && checklistItems.length > 0 && (
            <div className="space-y-2">
              {checklistItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={passedMap[item.name] ?? true}
                    onChange={(e) => setPassedMap((prev) => ({ ...prev, [item.name]: e.target.checked }))}
                    className="h-4 w-4 rounded border-input"
                  />
                  {item.name}
                </label>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{t('qcResult')}</p>
            <Select value={result} onValueChange={(v) => setResult(v as QcResult)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACCEPTED">{t('qcResultACCEPTED')}</SelectItem>
                <SelectItem value="REWORK">{t('qcResultREWORK')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{t('comment')}</p>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-success">{t('qcCheckRecorded')}</p>}
          <Button onClick={handleSubmit} loading={recordCheck.isPending}>
            {tc('save')}
          </Button>
        </CardContent>
      </Card>

      {qcChecks && qcChecks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('qcHistory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('qcResult')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('comment')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {qcChecks.map((check) => (
                  <TableRow key={check.id}>
                    <TableCell>
                      <Badge variant={check.result === 'ACCEPTED' ? 'success' : 'warning'}>{t(`qcResult${check.result}`)}</Badge>
                    </TableCell>
                    <TableCell>{new Date(check.checkedAt).toLocaleString()}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={check.comment ?? ''}>{check.comment ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
