'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/lib/api-client/types';
import { useValidateImport, useStartImport, useImportJob } from '@/lib/hooks/use-legacy-import';
import type { ImportReport, ImportJobStatus } from '@/lib/api-client/legacy-import';

type WizardStep = 'form' | 'preview' | 'progress';

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  TRANSFORMING: 'transforming',
  LOADING: 'loading',
  IMPORTING_PHOTOS: 'importingPhotos',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const STATUS_ORDER: ImportJobStatus[] = ['PENDING', 'FETCHING', 'TRANSFORMING', 'LOADING', 'VERIFYING', 'COMPLETED'];

export default function LegacyImportWizardPage() {
  const t = useTranslations('legacyImport');
  const tc = useTranslations('common');

  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceToken, setSourceToken] = useState('');
  const [step, setStep] = useState<WizardStep>('form');
  const [previewReport, setPreviewReport] = useState<ImportReport | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<{ step: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | undefined>(undefined);

  const validateImport = useValidateImport();
  const startImport = useStartImport();
  const jobQuery = useImportJob(jobId);

  const canSubmit = sourceUrl.trim().length > 0 && sourceToken.trim().length > 0;

  async function handleValidate() {
    setError(null);
    try {
      const result = await validateImport.mutateAsync({ sourceUrl, sourceToken, dryRun: true });
      setPreviewReport(result.report);
      setPreviewWarnings(result.warnings);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleConfirmImport() {
    setError(null);
    try {
      const job = await startImport.mutateAsync({ sourceUrl, sourceToken, dryRun: false });
      setJobId(job.id);
      setStep('progress');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {step === 'form' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('step1Title')}</CardTitle>
            <CardDescription>{t('step1Description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sourceUrl">{t('sourceUrl')}</Label>
              <Input
                id="sourceUrl"
                type="url"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sourceToken">{t('sourceToken')}</Label>
              <Input
                id="sourceToken"
                type="password"
                value={sourceToken}
                onChange={(e) => setSourceToken(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleValidate} loading={validateImport.isPending} disabled={!canSubmit}>
              {t('validateButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && previewReport && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('step2Title')}</CardTitle>
            <CardDescription>{t('step2Description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReportCounts report={previewReport} t={t} />
            {previewWarnings.length > 0 && <WarningsList warnings={previewWarnings} t={t} />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('form')}>
                {tc('back')}
              </Button>
              <Button onClick={handleConfirmImport} loading={startImport.isPending}>
                {t('confirmImportButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'progress' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('step3Title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobQuery.isLoading && <p className="text-sm text-muted-foreground">{tc('loading')}</p>}
            {jobQuery.data && <ProgressView job={jobQuery.data} t={t} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportCounts({ report, t }: { report: ImportReport; t: ReturnType<typeof useTranslations> }) {
  const rows: [string, number][] = [
    [t('countProducts'), report.counts.products],
    [t('countSuppliers'), report.counts.suppliers],
    [t('countWarehouses'), report.counts.warehouses],
    [t('countWarehouseStock'), report.counts.warehouseStock],
    [t('countAssemblies'), report.counts.assemblies],
    [t('countAssemblyVersions'), report.counts.assemblyVersions],
    [t('countCustomerOrders'), report.counts.customerOrders],
    [t('countStockMovements'), report.counts.stockMovements],
    [t('countPhotosDiscovered'), report.counts.photosDiscovered],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
      {report.counts.productsExcluded > 0 && (
        <div className="col-span-2 flex items-center justify-between rounded-md bg-warning/10 px-3 py-2">
          <dt className="text-warning-foreground">{t('countProductsExcluded')}</dt>
          <dd className="font-medium tabular-nums">{report.counts.productsExcluded}</dd>
        </div>
      )}
    </dl>
  );
}

function WarningsList({ warnings, t }: { warnings: { step: string; message: string }[]; t: ReturnType<typeof useTranslations> }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? warnings : warnings.slice(0, 5);
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
      <p className="mb-2 text-sm font-medium text-warning-foreground">
        {t('warningsCount', { count: warnings.length })}
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {shown.map((w, i) => (
          <li key={i}>
            <span className="font-mono">[{w.step}]</span> {w.message}
          </li>
        ))}
      </ul>
      {warnings.length > 5 && (
        <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('showLessWarnings') : t('showMoreWarnings', { count: warnings.length - 5 })}
        </button>
      )}
    </div>
  );
}

function ProgressView({ job, t }: { job: import('@/lib/api-client/legacy-import').ImportJob; t: ReturnType<typeof useTranslations> }) {
  const stageIndex = Math.max(0, STATUS_ORDER.indexOf(job.status));
  const totalStages = STATUS_ORDER.length - 1;
  const percent = job.status === 'FAILED' ? 100 : Math.round((stageIndex / totalStages) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={job.status} t={t} />
        {job.step && <span className="text-sm text-muted-foreground">{job.step}</span>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${job.status === 'FAILED' ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {job.status === 'FAILED' && job.errorMessage && (
        <p className="text-sm text-destructive">{job.errorMessage}</p>
      )}
      {job.status === 'COMPLETED' && job.report && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-success">{t('completedMessage')}</p>
          <ReportCounts report={job.report} t={t} />
          {job.warnings && job.warnings.length > 0 && <WarningsList warnings={job.warnings} t={t} />}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, t }: { status: ImportJobStatus; t: ReturnType<typeof useTranslations> }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'COMPLETED' ? 'success' : 'secondary';
  return <Badge variant={variant}>{t(`status.${STATUS_LABELS[status]}`)}</Badge>;
}
