'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePayrollSummary } from '@/lib/hooks/use-hr';
import type { PayrollSummaryLine } from '@/lib/api-client/hr';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { PrintArea, PrintDocumentHeader, PrintButton, PreviewButton } from '@/components/domain/print/print-area';

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

  const { data, isLoading } = usePayrollSummary({ from: from || undefined, to: to || undefined });

  function toggleExpanded(employeeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function articleLabel(line: { assemblyName: string | null; article: string | null }): string {
    if (!line.assemblyName && !line.article) return t('generalWork');
    return line.article ? `${line.assemblyName ?? ''} (${line.article})` : (line.assemblyName ?? '');
  }

  const periodSubtitle = from || to ? `${from ? new Date(from).toLocaleDateString() : '…'} – ${to ? new Date(to).toLocaleDateString() : '…'}` : undefined;

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      {tc('loading')}
                    </TableCell>
                  </TableRow>
                ) : !data || data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
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
                        </TableRow>
                        {isOpen && line.byArticle.length > 0 && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/20 py-3">
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
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data && data.length > 0 && (
        <PrintArea>
          <PrintDocumentHeader title={t('payrollSummary')} subtitle={periodSubtitle} />
          <div className="space-y-5">
            {data.map((line) => (
              <PayrollEmployeePrintBlock key={line.employeeId} line={line} t={t} articleLabel={articleLabel} />
            ))}
          </div>
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
