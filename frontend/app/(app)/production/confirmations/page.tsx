'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { useProductionExecutions, useConfirmProductionExecution } from '@/lib/hooks/use-production-labor';
import { useProductionOrder } from '@/lib/hooks/use-production';
import { useWorkTask } from '@/lib/hooks/use-production-labor';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useEmployee } from '@/lib/hooks/use-hr';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { ProductionExecution } from '@/lib/api-client/production-labor';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useState } from 'react';

function EmployeeNames({ execution }: { execution: ProductionExecution }) {
  return (
    <>
      {execution.allocations.map((a, i) => (
        <EmployeeName key={a.id} employeeId={a.employeeId} last={i === execution.allocations.length - 1} />
      ))}
    </>
  );
}

function EmployeeName({ employeeId, last }: { employeeId: string; last: boolean }) {
  const { data: employee } = useEmployee(employeeId);
  return (
    <>
      {employee?.fullName ?? '…'}
      {!last && ', '}
    </>
  );
}

function ParentCell({ execution }: { execution: ProductionExecution }) {
  const t = useTranslations('production');
  const { data: order } = useProductionOrder(execution.productionOrderId ?? undefined);
  const { data: assembly } = useAssembly(order?.assemblyId);
  const { data: workTask } = useWorkTask(execution.workTaskId ?? undefined);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', order?.assemblyId ? [order.assemblyId] : [], 'ASSEMBLY_PHOTO');

  if (execution.productionOrderId) {
    return (
      <Link href={`/production/${execution.productionOrderId}`} className="flex items-center gap-2 text-primary hover:underline">
        <Avatar src={order?.assemblyId ? photosByAssembly?.[order.assemblyId]?.[0]?.downloadUrl : undefined} size="sm" />
        {assembly ? `${assembly.article ? `${assembly.article} — ` : ''}${assembly.name}` : '…'}
      </Link>
    );
  }
  return (
    <Link href={`/production/work-tasks/${execution.workTaskId}`} className="text-primary hover:underline">
      {workTask?.title ?? t('confirmationsGeneralWorkFallback')}
    </Link>
  );
}

/**
 * "Подано через Telegram ... надходить на підтвердження" (2026-10-01 user
 * request) — a global queue of every DRAFT ProductionExecution across every
 * order/work task, which previously only existed per-parent
 * (ProductionExecutionsPanel, embedded in each order's/task's own detail
 * page — a supervisor had to already know where to look). Confirming here
 * is the exact same action (useConfirmProductionExecution), just reachable
 * without first finding the right parent — a bot-submitted execution is a
 * completely ordinary DRAFT row, nothing is duplicated.
 */
export default function ProductionConfirmationsPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const canConfirm = useHasPermission('production-executions:confirm');
  const { data, isLoading } = useProductionExecutions({ status: 'DRAFT', limit: 200 });
  const confirmExecution = useConfirmProductionExecution();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(id: string) {
    setError(null);
    try {
      await confirmExecution.mutateAsync(id);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('confirmationsDescription')}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('performedAt')}</TableHead>
            <TableHead>{t('confirmationsItemColumn')}</TableHead>
            <TableHead>{t('qtyCompletedLabel')}</TableHead>
            <TableHead>{t('confirmationsEmployeeColumn')}</TableHead>
            <TableHead>{t('totalAmountLabel')}</TableHead>
            <TableHead className="w-40">{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                <LoadingBlock />
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>{new Date(execution.performedAt).toLocaleString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ParentCell execution={execution} />
                    {execution.submittedViaTelegram && (
                      <Badge variant="secondary" className="gap-1">
                        <Send className="h-3 w-3" />
                        Telegram
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{execution.qtyCompleted ?? '—'}</TableCell>
                <TableCell>
                  <EmployeeNames execution={execution} />
                </TableCell>
                <TableCell>{Number(execution.totalAmount).toFixed(2)} €</TableCell>
                <TableCell>
                  {canConfirm && (
                    <Button size="sm" loading={confirmExecution.isPending} onClick={() => handleConfirm(execution.id)}>
                      {t('confirmExecution')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
