'use client';

import { Fragment, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Printer, Users } from 'lucide-react';
import { useOrderPayrollByEmployee } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur, formatQty } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PrintArea, PrintDocumentHeader } from '@/components/domain/print/print-area';
import { EmployeePayrollPrintBlock } from '@/components/domain/sales/employee-payroll-print-block';

/** Same inlined exclusivity toggle hr/payroll/summary/page.tsx's own per-employee print uses — see that file's own header comment for why this is a plain DOM toggle rather than usePrintOptions (no columns/photos dialog needed for a single "print now" click). */
function activateOnlyPrintArea(id: string) {
  document.querySelectorAll('.print-area').forEach((el) => {
    el.classList.toggle('print-area--active', el.getAttribute('data-print-area-id') === id);
  });
}

/**
 * "По працівниках" tab on План виробництва's order detail, and HR's
 * "Зарплата по замовленню" lookup (2026-08-30 / 2026-09-16 user requests) —
 * one row per employee who earned PIECEWORK pay on this order, click to
 * expand their own article/qty/amount breakdown.
 *
 * 2026-09-16 user request ("зроби щоб це виглядало як зведення по зарплаті
 * але не загальне а на окреме замовлення"): restyled from one Card per
 * employee to the SAME single-table/chevron-expand/grand-total layout
 * hr/payroll/summary/page.tsx's `summaryByEmployee` table already uses —
 * this is deliberately the order-scoped sibling of that view, not a
 * different shape. Only PIECEWORK earned on THIS order can appear here at
 * all: ADVANCE/BONUS/PENALTY entries have no order association anywhere in
 * the data model (RecordPayrollEntryDto has no order field — they're
 * employee-level events, not order-scoped), so unlike the general summary's
 * table this has no columns for them, and "grand total" is simply the sum
 * of what's shown, not a signed net.
 *
 * Same visit's follow-up: a per-row print button ("також додай можливість
 * друкувати по конкретному працівнику") — isolates just that one employee's
 * block (`EmployeePayrollPrintBlock`, shared with `OrderPayrollPrint`'s own
 * full-report section) into its own `<PrintArea>`, same
 * mounted-but-inactive-by-default + explicit-activate-before-print pattern
 * every multi-print-area page in this app already uses. No EUR/UAH rate
 * field here — `EmployeePayrollPrintBlock` is deliberately EUR-only (see
 * its own header comment), so there's nothing for a rate to affect on this
 * specific print.
 */
export function OrderPayrollByEmployee({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const th = useTranslations('hr');
  const tp = useTranslations('print');
  const { data: lines, isLoading } = useOrderPayrollByEmployee(orderId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [printEmployeeId, setPrintEmployeeId] = useState<string | null>(null);
  const employeePrintAreaId = useId();
  const assemblyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines ?? []) for (const a of line.byArticle) if (a.assemblyId) ids.add(a.assemblyId);
    return Array.from(ids);
  }, [lines]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  function toggleExpanded(employeeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function handlePrintEmployee(employeeId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPrintEmployeeId(employeeId);
    window.setTimeout(() => {
      activateOnlyPrintArea(employeePrintAreaId);
      window.print();
    }, 50);
  }

  if (isLoading) return <LoadingBlock />;
  if (!lines || lines.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState icon={Users} title={t('payrollByEmployeeEmpty')} />
        </CardContent>
      </Card>
    );
  }

  const grandTotal = lines.reduce((sum, line) => sum + line.totalEarned, 0);
  const printLine = lines.find((l) => l.employeeId === printEmployeeId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{th('summaryByEmployee')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{th('employee')}</TableHead>
              <TableHead>{t('payrollFundEarned')}</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const isOpen = expanded.has(line.employeeId);
              return (
                <Fragment key={line.employeeId}>
                  <TableRow className="cursor-pointer" onClick={() => toggleExpanded(line.employeeId)}>
                    <TableCell>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell>{line.employeeName}</TableCell>
                    <TableCell className="font-medium">{formatEur(line.totalEarned)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={tp('printAction')}
                        onClick={(e) => handlePrintEmployee(line.employeeId, e)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isOpen && line.byArticle.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="bg-muted/20 py-3">
                        <div className="space-y-1 pl-8">
                          <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground">
                            <span>{t('payrollFundArticle')}</span>
                            <span className="text-right">{t('payrollFundUnitsProduced')}</span>
                            <span className="text-right">{t('payrollFundEarned')}</span>
                          </div>
                          {line.byArticle.map((a) => (
                            <div key={a.assemblyId ?? 'general'} className="grid grid-cols-3 items-center gap-2 text-sm">
                              {a.assemblyId ? (
                                <div className="flex items-center gap-2">
                                  <Avatar src={photosByAssembly?.[a.assemblyId]?.[0]?.downloadUrl} size="sm" />
                                  <div className="min-w-0">
                                    {a.article && <p className="truncate text-xs text-muted-foreground">{a.article}</p>}
                                    <p className="max-w-[200px] truncate" title={a.assemblyName ?? undefined}>
                                      {a.assemblyName}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">{a.assemblyName ?? t('payrollFundGeneralWork')}</span>
                              )}
                              <span className="text-right tabular-nums">{a.unitsProduced ? formatQty(a.unitsProduced) : '—'}</span>
                              <span className="text-right tabular-nums">{formatEur(a.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            <TableRow className="font-semibold">
              <TableCell />
              <TableCell>{th('grandTotal')}</TableCell>
              <TableCell>{formatEur(grandTotal)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>

      {printLine && (
        <PrintArea printAreaId={employeePrintAreaId}>
          <PrintDocumentHeader title={tp('orderPayrollTitle')} subtitle={orderLabel ? `${orderLabel} — ${printLine.employeeName}` : printLine.employeeName} />
          <EmployeePayrollPrintBlock line={printLine} photosByAssembly={photosByAssembly} />
        </PrintArea>
      )}
    </Card>
  );
}
