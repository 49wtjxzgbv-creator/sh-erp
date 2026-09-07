'use client';

import { Fragment, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { usePayrollSummary } from '@/lib/hooks/use-hr';
import type { PayrollSummaryLine } from '@/lib/api-client/hr';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { PrintArea, PrintDocumentHeader, PrintButton, PreviewButton } from '@/components/domain/print/print-area';

/** Toggles which mounted `.print-area` the browser's next `window.print()` shows — same pattern as usePrintOptions (print-options.tsx), inlined here since this page needs no columns/photos dialog, just isolation between the whole-summary print and a single employee's. */
function activateOnlyPrintArea(id: string) {
  document.querySelectorAll('.print-area').forEach((el) => {
    el.classList.toggle('print-area--active', el.getAttribute('data-print-area-id') === id);
  });
}

/**
 * Per-employee totals by entry type, plus a QC-defect count
 * cross-referenced through each employee's assigned production orders
 * (Phase 1 §6.5, confirmed from payroll.service.ts#getPayrollSummaryReport).
 * All fields are computed JSON numbers, not DecimalString — see
 * lib/api-client/decimal.ts's convention note.
 *
 * `byArticle` (2026-08-28 user request): which article/скільки кожен
 * зробив і скільки за це отримав, for the same period — on-screen it's a
 * per-employee expandable row (no premade Accordion/Collapsible primitive
 * in this codebase, so a plain local-state Set toggle, same convention as
 * inventory/page.tsx's hiddenColumns); the print view always shows it
 * inline, since a printed sheet has no interactivity to expand with.
 */
export default function PayrollSummaryPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('print');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Per-employee print (2026-09-06 user request): "натиснути кнопку і
  // друкувати тільки його зарплату" — a separate PrintArea mounted only
  // while an employee is selected, isolated from the always-mounted
  // whole-summary one below via printAreaId/activateOnlyPrintArea (same
  // multi-PrintArea-on-one-page gotcha as production/[id]/page.tsx).
  const [printEmployee, setPrintEmployee] = useState<PayrollSummaryLine | null>(null);
  const summaryPrintAreaId = useId();
  const employeePrintAreaId = useId();

  const { data, isLoading } = usePayrollSummary({ from: from || undefined, to: to || undefined });

  function toggleExpanded(employeeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  // Reset after the print dialog closes (fires on both print and cancel) so
  // a later plain "Друкувати" (whole summary) isn't left pointed at the
  // employee-only print area.
  useEffect(() => {
    function reset() {
      setPrintEmployee(null);
      activateOnlyPrintArea(summaryPrintAreaId);
    }
    window.addEventListener('afterprint', reset);
    return () => window.removeEventListener('afterprint', reset);
  }, [summaryPrintAreaId]);

  function handlePrintEmployee(line: PayrollSummaryLine, e: React.MouseEvent) {
    e.stopPropagation();
    setPrintEmployee(line);
    window.setTimeout(() => {
      activateOnlyPrintArea(employeePrintAreaId);
      window.print();
    }, 50);
  }

  function articleLabel(line: { assemblyName: string | null; article: string | null }): string {
    if (!line.assemblyName && !line.article) return t('generalWork');
    return line.article ? `${line.assemblyName ?? ''} (${line.article})` : (line.assemblyName ?? '');
  }

  const periodSubtitle = from || to ? `${from ? new Date(from).toLocaleDateString() : '…'} – ${to ? new Date(to).toLocaleDateString() : '…'}` : undefined;

  // Grand total across every employee (2026-09-07 user request) — a plain
  // reduce over the same lines already fetched, not a separate backend
  // field: cheap to compute client-side, and always matches whatever rows
  // are currently on screen (same from/to filter, no separate query to
  // keep in sync).
  const totals = (data ?? []).reduce(
    (acc, line) => ({
      piecework: acc.piecework + line.piecework,
      advances: acc.advances + line.advances,
      bonuses: acc.bonuses + line.bonuses,
      penalties: acc.penalties + line.penalties,
      netTotal: acc.netTotal + line.netTotal,
      defectCount: acc.defectCount + line.defectCount,
    }),
    { piecework: 0, advances: 0, bonuses: 0, penalties: 0, netTotal: 0, defectCount: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('payrollSummary')}</h2>
          <div className="flex items-center gap-2">
            <PrintButton label={tp('printAction')} />
            <PreviewButton />
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="from">{t('fromDate')}</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{t('toDate')}</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('summaryByEmployee')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('employee')}</TableHead>
                  <TableHead>{t('entryTypePIECEWORK')}</TableHead>
                  <TableHead>{t('entryTypeADVANCE')}</TableHead>
                  <TableHead>{t('entryTypeBONUS')}</TableHead>
                  <TableHead>{t('entryTypePENALTY')}</TableHead>
                  <TableHead>{t('netTotal')}</TableHead>
                  <TableHead>{t('defectCount')}</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                      {tc('loading')}
                    </TableCell>
                  </TableRow>
                ) : !data || data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                      {tc('noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((line) => {
                    const isOpen = expanded.has(line.employeeId);
                    return (
                      <Fragment key={line.employeeId}>
                        <TableRow className="cursor-pointer" onClick={() => toggleExpanded(line.employeeId)}>
                          <TableCell>
                            {line.byArticle.length > 0 &&
                              (isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />)}
                          </TableCell>
                          <TableCell>{line.employeeName}</TableCell>
                          <TableCell>{formatEur(line.piecework)}</TableCell>
                          <TableCell>{formatEur(line.advances)}</TableCell>
                          <TableCell>{formatEur(line.bonuses)}</TableCell>
                          <TableCell>{formatEur(line.penalties)}</TableCell>
                          <TableCell className="font-medium">{formatEur(line.netTotal)}</TableCell>
                          <TableCell>
                            {line.defectCount > 0 ? <Badge variant="warning">{line.defectCount}</Badge> : line.defectCount}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={tp('printAction')}
                              onClick={(e) => handlePrintEmployee(line, e)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && line.byArticle.length > 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/20 py-3">
                              <div className="space-y-1 pl-8">
                                <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground">
                                  <span>{t('article')}</span>
                                  <span className="text-right">{t('unitsProduced')}</span>
                                  <span className="text-right">{t('entryTypePIECEWORK')}</span>
                                </div>
                                {line.byArticle.map((a) => (
                                  <div key={a.assemblyId ?? 'general'} className="grid grid-cols-3 gap-2 text-sm">
                                    <span className="truncate">{articleLabel(a)}</span>
                                    <span className="text-right tabular-nums">{a.unitsProduced || '—'}</span>
                                    <span className="text-right tabular-nums">{formatEur(a.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
                {data && data.length > 0 && (
                  <TableRow className="font-semibold">
                    <TableCell />
                    <TableCell>{t('grandTotal')}</TableCell>
                    <TableCell>{formatEur(totals.piecework)}</TableCell>
                    <TableCell>{formatEur(totals.advances)}</TableCell>
                    <TableCell>{formatEur(totals.bonuses)}</TableCell>
                    <TableCell>{formatEur(totals.penalties)}</TableCell>
                    <TableCell>{formatEur(totals.netTotal)}</TableCell>
                    <TableCell>{totals.defectCount > 0 ? <Badge variant="warning">{totals.defectCount}</Badge> : totals.defectCount}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data && data.length > 0 && (
        <PrintArea printAreaId={summaryPrintAreaId}>
          <PrintDocumentHeader title={t('payrollSummary')} subtitle={periodSubtitle} />
          <table className="mb-6 w-full text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1 font-semibold">{t('employee')}</th>
                <th className="py-1 text-right font-semibold">{t('netTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((line) => (
                <tr key={line.employeeId} className="border-b border-gray-300">
                  <td className="py-1">{line.employeeName}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{formatEur(line.netTotal)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-bold">
                <td className="py-1">{t('grandTotal')}</td>
                <td className="py-1 text-right tabular-nums">{formatEur(totals.netTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className="space-y-5">
            {data.map((line) => (
              <PayrollEmployeePrintBlock key={line.employeeId} line={line} t={t} articleLabel={articleLabel} />
            ))}
          </div>
        </PrintArea>
      )}

      {printEmployee && (
        <PrintArea printAreaId={employeePrintAreaId}>
          <PrintDocumentHeader title={t('payrollSummary')} subtitle={periodSubtitle} />
          <PayrollEmployeePrintBlock line={printEmployee} t={t} articleLabel={articleLabel} />
        </PrintArea>
      )}
    </div>
  );
}

function PayrollEmployeePrintBlock({
  line,
  t,
  articleLabel,
}: {
  line: PayrollSummaryLine;
  t: ReturnType<typeof useTranslations>;
  articleLabel: (l: { assemblyName: string | null; article: string | null }) => string;
}) {
  return (
    <div className="break-inside-avoid border-b border-gray-300 pb-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">{line.employeeName}</h3>
        <span className="text-sm font-semibold">
          {t('netTotal')}: {formatEur(line.netTotal)}
        </span>
      </div>
      {line.byArticle.length > 0 && (
        <table className="mb-1.5 w-full text-xs">
          <thead>
            <tr className="border-b border-gray-300 text-left">
              <th className="py-1 font-medium">{t('article')}</th>
              <th className="py-1 text-right font-medium">{t('unitsProduced')}</th>
              <th className="py-1 text-right font-medium">{t('entryTypePIECEWORK')}</th>
            </tr>
          </thead>
          <tbody>
            {line.byArticle.map((a) => (
              <tr key={a.assemblyId ?? 'general'}>
                <td className="py-0.5">{articleLabel(a)}</td>
                <td className="py-0.5 text-right tabular-nums">{a.unitsProduced || '—'}</td>
                <td className="py-0.5 text-right tabular-nums">{formatEur(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-x-4 text-xs text-gray-700">
        <span>
          {t('entryTypeADVANCE')}: {formatEur(line.advances)}
        </span>
        <span>
          {t('entryTypeBONUS')}: {formatEur(line.bonuses)}
        </span>
        <span>
          {t('entryTypePENALTY')}: {formatEur(line.penalties)}
        </span>
        {line.defectCount > 0 && (
          <span>
            {t('defectCount')}: {line.defectCount}
          </span>
        )}
      </div>
    </div>
  );
}
