'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Download, Plus, RefreshCw, Unplug } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';
import { useApiErrorMessage } from '@/lib/api-error-message';
import {
  useImportProviders,
  useConnections,
  useConnection,
  useStartConnection,
  useHealthCheck,
  useRevokeConnection,
  useReconnectConnection,
  useValidateImport,
  useStartImport,
  useImportJob,
} from '@/lib/hooks/use-legacy-import';
import type {
  ImportConnection,
  ImportReport,
  ImportJob,
  ImportJobStatus,
  ReportIssue,
  ConnectorHealth,
} from '@/lib/api-client/legacy-import';

type View =
  | { name: 'list' }
  | { name: 'add-source' }
  | { name: 'pairing'; connectionId: string }
  | { name: 'run'; connectionId: string };

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

const ENTITY_LABEL_KEYS: Record<string, string> = {
  products: 'entityProducts',
  suppliers: 'entitySuppliers',
  warehouses: 'entityWarehouses',
  warehouseStock: 'entityWarehouseStock',
  assemblies: 'entityAssemblies',
  assemblyComponents: 'entityAssemblyComponents',
  assemblyVersions: 'entityAssemblyVersions',
  customerOrders: 'entityCustomerOrders',
  customerOrderItems: 'entityCustomerOrderItems',
  stockMovements: 'entityStockMovements',
  newUnits: 'entityNewUnits',
};

export default function LegacyImportPage() {
  const t = useTranslations('legacyImport');
  const [view, setView] = useState<View>({ name: 'list' });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {view.name === 'list' && (
        <ConnectionsListView
          onAddSource={() => setView({ name: 'add-source' })}
          onRun={(connectionId) => setView({ name: 'run', connectionId })}
          onPairing={(connectionId) => setView({ name: 'pairing', connectionId })}
        />
      )}
      {view.name === 'add-source' && (
        <AddSourceView
          onCreated={(connectionId) => setView({ name: 'pairing', connectionId })}
          onBack={() => setView({ name: 'list' })}
        />
      )}
      {view.name === 'pairing' && (
        <PairingView connectionId={view.connectionId} onDone={() => setView({ name: 'list' })} onBack={() => setView({ name: 'list' })} />
      )}
      {view.name === 'run' && (
        <RunImportView connectionId={view.connectionId} onBack={() => setView({ name: 'list' })} />
      )}
    </div>
  );
}

// ============================================================================
// Connections list
// ============================================================================

function ConnectionsListView({
  onAddSource,
  onRun,
  onPairing,
}: {
  onAddSource: () => void;
  onRun: (connectionId: string) => void;
  onPairing: (connectionId: string) => void;
}) {
  const t = useTranslations('legacyImport');
  const apiErrorMessage = useApiErrorMessage();
  const { data: connections, isLoading } = useConnections();
  const healthCheck = useHealthCheck();
  const revoke = useRevokeConnection();
  const reconnect = useReconnectConnection();
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onAddSource}>
          <Plus className="mr-2 h-4 w-4" />
          {t('addSource')}
        </Button>
      </div>

      {(!connections || connections.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('noConnections')}</CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        {connections?.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            onRun={() => onRun(connection.id)}
            onHealthCheck={async () => {
              setError(null);
              try {
                await healthCheck.mutateAsync(connection.id);
              } catch (err) {
                setError(apiErrorMessage(err, t('genericError')));
              }
            }}
            onRevoke={async () => {
              setError(null);
              try {
                await revoke.mutateAsync(connection.id);
              } catch (err) {
                setError(apiErrorMessage(err, t('genericError')));
              }
            }}
            onReconnect={async () => {
              setError(null);
              try {
                await reconnect.mutateAsync(connection.id);
                onPairing(connection.id); // reconnect regenerates a pairing code on the same connection — show the pairing screen, not the run screen
              } catch (err) {
                setError(apiErrorMessage(err, t('genericError')));
              }
            }}
            healthCheckPending={healthCheck.isPending}
            revokePending={revoke.isPending}
            reconnectPending={reconnect.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({
  connection,
  onRun,
  onHealthCheck,
  onRevoke,
  onReconnect,
  healthCheckPending,
  revokePending,
  reconnectPending,
}: {
  connection: ImportConnection;
  onRun: () => void;
  onHealthCheck: () => void;
  onRevoke: () => void;
  onReconnect: () => void;
  healthCheckPending: boolean;
  revokePending: boolean;
  reconnectPending: boolean;
}) {
  const t = useTranslations('legacyImport');
  const statusVariant = connection.status === 'PAIRED' ? 'success' : connection.status === 'REVOKED' ? 'destructive' : 'secondary';

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{connection.label}</p>
            <p className="text-xs text-muted-foreground">
              {connection.providerType === 'GOOGLE_APPS_SCRIPT' ? 'Google Apps Script' : connection.providerType}
              {connection.connectorVersion && ` · v${connection.connectorVersion}`}
            </p>
          </div>
          <Badge variant={statusVariant}>{t(`connectionStatus.${connection.status.toLowerCase()}`)}</Badge>
        </div>

        {connection.lastHealthStatus && <HealthDiagnostics health={connection.lastHealthStatus} />}

        <div className="flex flex-wrap gap-2 pt-1">
          {connection.status === 'PAIRED' && (
            <>
              <Button size="sm" variant="outline" onClick={onHealthCheck} loading={healthCheckPending}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('checkConnection')}
              </Button>
              <Button size="sm" onClick={onRun}>
                {t('checkData')}
              </Button>
            </>
          )}
          {/* Reconnect always available, regardless of status — it's how a REVOKED connection gets revived (same connection row, fresh pairing code, no need to recreate the Apps Script project), and how a PENDING one that lost its code gets a new one. */}
          <Button size="sm" variant="outline" onClick={onReconnect} loading={reconnectPending}>
            {t('reconnect')}
          </Button>
          {connection.status === 'PAIRED' && (
            <Button size="sm" variant="ghost" onClick={onRevoke} loading={revokePending}>
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              {t('revoke')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthDiagnostics({ health }: { health: ConnectorHealth }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {health.diagnostics.map((d) => (
        <span key={d.label} className="inline-flex items-center gap-1">
          <span className={d.ok ? 'text-success' : 'text-destructive'}>{d.ok ? '✓' : '✗'}</span>
          {d.label}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// Add source (provider pick + pairing handshake)
// ============================================================================

function AddSourceView({ onCreated, onBack }: { onCreated: (connectionId: string) => void; onBack: () => void }) {
  const t = useTranslations('legacyImport');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: providers } = useImportProviders();
  const startConnection = useStartConnection();
  const [label, setLabel] = useState('');
  const [providerType, setProviderType] = useState('GOOGLE_APPS_SCRIPT');
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);
    try {
      const created = await startConnection.mutateAsync({ providerType, label: label.trim() || undefined });
      onCreated(created.id);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('addSourceTitle')}</CardTitle>
        <CardDescription>{t('addSourceDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="provider">{t('providerLabel')}</Label>
          <select
            id="provider"
            value={providerType}
            onChange={(e) => setProviderType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            {(providers ?? [{ type: 'GOOGLE_APPS_SCRIPT', displayName: 'Google Apps Script' }]).map((p) => (
              <option key={p.type} value={p.type}>{p.displayName}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">{t('connectionLabelField')}</Label>
          <Input id="label" placeholder={t('connectionLabelPlaceholder')} value={label} onChange={(e) => setLabel(e.target.value)} className="max-w-sm" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>{tc('back')}</Button>
          <Button onClick={handleStart} loading={startConnection.isPending}>{t('startPairing')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Shown both right after creating a new connection AND after clicking
 * "Перепідключити" on an existing one (reconnect just puts the SAME
 * connection back into PENDING with a fresh code — same screen either way,
 * no need to recreate the Apps Script project).
 */
function PairingView({ connectionId, onDone, onBack }: { connectionId: string; onDone: () => void; onBack: () => void }) {
  const t = useTranslations('legacyImport');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const connectionQuery = useConnection(connectionId);
  const connection = connectionQuery.data;

  if (connection?.status === 'PAIRED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-success">{t('pairedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection.lastHealthStatus && <HealthDiagnostics health={connection.lastHealthStatus} />}
          <Button onClick={onDone}>{t('backToList')}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('pairingTitle')}</CardTitle>
        <CardDescription>{t('pairingDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border bg-secondary/40 p-4 text-center">
          <p className="text-xs text-muted-foreground">{t('pairingCodeLabel')}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{connection?.pairingCode}</p>
          {connection?.pairingCodeExpiresAt && (
            <p className="mt-1 text-xs text-muted-foreground">{t('pairingCodeExpiry')}</p>
          )}
        </div>

        <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
          <li>{t('instructionStep1')}</li>
          <li>{t('instructionStep2')}</li>
          <li>{t('instructionStep3')}</li>
          <li>{t('instructionStep4')}</li>
          <li>{t('instructionStep5')}</li>
        </ol>

        <a href="/SHERPImportConnector.gs" download="SHERPImportConnector.gs" className="inline-flex">
          <Button variant="outline" size="sm" type="button">
            <Download className="mr-2 h-4 w-4" />
            {t('downloadConnector')}
          </Button>
        </a>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          {t('waitingForConnection')}
        </div>

        <Button variant="outline" onClick={onBack}>{tc('cancel')}</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Run: preview (validate) -> confirm -> progress
// ============================================================================

function RunImportView({ connectionId, onBack }: { connectionId: string; onBack: () => void }) {
  const t = useTranslations('legacyImport');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const validateImport = useValidateImport();
  const startImport = useStartImport();
  const jobQuery = useImportJob(jobId);

  async function handleValidate() {
    setError(null);
    try {
      const result = await validateImport.mutateAsync(connectionId);
      setReport(result);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConfirmImport() {
    setError(null);
    try {
      const job = await startImport.mutateAsync({ connectionId, dryRun: false });
      setJobId(job.id);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (jobId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('progressTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobQuery.isLoading && <p className="text-sm text-muted-foreground">{tc('loading')}</p>}
          {jobQuery.data && <ProgressView job={jobQuery.data} />}
          {jobQuery.data && (jobQuery.data.status === 'COMPLETED' || jobQuery.data.status === 'FAILED') && (
            <Button variant="outline" onClick={onBack}>{t('backToList')}</Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('previewTitle')}</CardTitle>
          <CardDescription>{t('previewDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>{tc('back')}</Button>
            <Button onClick={handleValidate} loading={validateImport.isPending}>{t('checkData')}</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const blocked = report.errors.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('previewTitle')}</CardTitle>
        <CardDescription>{t('previewDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EntityReportTable report={report} />

        {report.errors.length > 0 && (
          <IssuesBlock title={t('errorsCount', { count: report.errors.length })} issues={report.errors} tone="destructive" />
        )}
        {report.conflicts.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="mb-2 text-sm font-medium text-destructive">{t('conflictsCount', { count: report.conflicts.length })}</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {report.conflicts.map((c, i) => <li key={i}>{c.description}</li>)}
            </ul>
          </div>
        )}
        {report.warnings.length > 0 && (
          <IssuesBlock title={t('warningsCount', { count: report.warnings.length })} issues={report.warnings} tone="warning" />
        )}

        {blocked && <p className="text-sm font-medium text-destructive">{t('blockedByErrors')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setReport(null)}>{tc('back')}</Button>
          <Button onClick={handleConfirmImport} loading={startImport.isPending} disabled={blocked}>
            {t('confirmImportButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EntityReportTable({ report }: { report: ImportReport }) {
  const t = useTranslations('legacyImport');
  const rows = report.entities.filter((e) => e.total > 0 || e.willCreate > 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">{t('entityColumn')}</th>
            <th className="py-1.5 text-right font-medium">{t('totalColumn')}</th>
            <th className="py-1.5 text-right font-medium">{t('createColumn')}</th>
            <th className="py-1.5 text-right font-medium">{t('updateColumn')}</th>
            <th className="py-1.5 text-right font-medium">{t('skipColumn')}</th>
            {rows.some((r) => r.failed !== undefined) && <th className="py-1.5 text-right font-medium">{t('failedColumn')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entity} className="border-b border-border/50">
              <td className="py-1.5">{t(ENTITY_LABEL_KEYS[r.entity] ?? r.entity)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.total}</td>
              <td className="py-1.5 text-right tabular-nums text-success">{r.willCreate}</td>
              <td className="py-1.5 text-right tabular-nums">{r.willUpdate}</td>
              <td className="py-1.5 text-right tabular-nums text-warning-foreground">{r.willSkip}</td>
              {rows.some((x) => x.failed !== undefined) && <td className="py-1.5 text-right tabular-nums text-destructive">{r.failed ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">{t('countPhotosDiscovered')}: {report.photosDiscovered}</p>
    </div>
  );
}

function IssuesBlock({ title, issues, tone }: { title: string; issues: ReportIssue[]; tone: 'destructive' | 'warning' }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations('legacyImport');
  const shown = expanded ? issues : issues.slice(0, 5);
  const border = tone === 'destructive' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5';
  const titleColor = tone === 'destructive' ? 'text-destructive' : 'text-warning-foreground';

  return (
    <div className={`rounded-md border p-3 ${border}`}>
      <p className={`mb-2 text-sm font-medium ${titleColor}`}>{title}</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {shown.map((w, i) => (
          <li key={i}><span className="font-mono">[{w.step}]</span> {w.message}</li>
        ))}
      </ul>
      {issues.length > 5 && (
        <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('showLessWarnings') : t('showMoreWarnings', { count: issues.length - 5 })}
        </button>
      )}
    </div>
  );
}

function ProgressView({ job }: { job: ImportJob }) {
  const t = useTranslations('legacyImport');
  const stageIndex = Math.max(0, STATUS_ORDER.indexOf(job.status));
  const totalStages = STATUS_ORDER.length - 1;
  const percent = job.status === 'FAILED' ? 100 : Math.round((stageIndex / totalStages) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={job.status} />
        {job.step && <span className="text-sm text-muted-foreground">{job.step}</span>}
        {job.status === 'IMPORTING_PHOTOS' && job.totalPhotos !== null && (
          <span className="text-sm text-muted-foreground">{t('photosProgress', { done: job.processedPhotos, total: job.totalPhotos })}</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${job.status === 'FAILED' ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {job.status === 'FAILED' && job.errorMessage && <p className="text-sm text-destructive">{job.errorMessage}</p>}
      {job.status === 'COMPLETED' && job.report && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-success">{t('completedMessage')}</p>
            {job.durationMs !== null && (
              <p className="text-xs text-muted-foreground">{t('durationLabel', { seconds: Math.round(job.durationMs / 1000) })}</p>
            )}
          </div>
          <EntityReportTable report={job.report} />
          {!!job.report.photosMissing && job.report.photosMissing > 0 && (
            <p className="text-sm text-destructive">{t('photosMissingCount', { count: job.report.photosMissing })}</p>
          )}
          {job.report.warnings.length > 0 && <IssuesBlock title={t('warningsCount', { count: job.report.warnings.length })} issues={job.report.warnings} tone="warning" />}
          <Button variant="outline" size="sm" onClick={() => downloadReport(job)}>
            <Download className="mr-2 h-4 w-4" />
            {t('downloadReport')}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportJobStatus }) {
  const t = useTranslations('legacyImport');
  const variant = status === 'FAILED' ? 'destructive' : status === 'COMPLETED' ? 'success' : 'secondary';
  return <Badge variant={variant}>{t(`status.${STATUS_LABELS[status]}`)}</Badge>;
}

function downloadReport(job: ImportJob) {
  const blob = new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sh-erp-import-report-${job.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
