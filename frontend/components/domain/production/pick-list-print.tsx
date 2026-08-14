'use client';

import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import type { ProductionOrderPickListItem } from '@/lib/api-client/production';
import type { DecimalString } from '@/lib/api-client/decimal';

export interface PickListPrintProps {
  orderId: string;
  assemblyId: string;
  unitsPlanned: DecimalString;
  pickListItems: ProductionOrderPickListItem[];
}

/**
 * Prints `order.pickListItems` — the materials-consumption breakdown
 * (description/qty/unitPriceEur/lineTotalEur) already rendered on the
 * production order detail page, in a dedicated print layout. This is a
 * deliberate scope decision, not an oversight: the legacy warehouse
 * pick/issue sheet ("Аркуш видачі зі складу") had a richer per-line shape —
 * article, internal code, bin/cell location, and consumed serial numbers for
 * sub-assembly components — none of which exist on this backend's
 * `ProductionOrderPickListItem` (it only carries a free-text `description`,
 * see `lib/api-client/production.ts`). Reproducing the legacy sheet exactly
 * would need a new backend field/endpoint, out of scope for this pass; this
 * prints exactly what the order detail page already shows on screen, adding
 * no new data exposure, with the assembly's real name resolved (rather than
 * the raw id shown on screen) since a printed document handed to a customer
 * or shop floor worker showing a UUID would be a real regression.
 */
export function PickListPrint({ orderId, assemblyId, unitsPlanned, pickListItems }: PickListPrintProps) {
  const t = useTranslations('production');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'qty', label: t('qty') },
    { id: 'unitPrice', label: t('unitPrice') },
    { id: 'lineTotal', label: t('lineTotal') },
  ];
  const printOptions = usePrintOptions({ columns });

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printPickList')}
        />
        <PreviewButton />
      </div>
      <PrintArea>
        <PrintDocumentHeader
          title={tp('pickListTitle')}
          subtitle={`${assembly?.name ?? assemblyId} — ${unitsPlanned} ${tp('units')} — ${tp('orderId')} ${orderId.slice(0, 8)}`}
        />
        <table>
          <thead>
            <tr>
              {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
              {printOptions.isColumnVisible('qty') && <th>{t('qty')}</th>}
              {printOptions.isColumnVisible('unitPrice') && <th>{t('unitPrice')}</th>}
              {printOptions.isColumnVisible('lineTotal') && <th>{t('lineTotal')}</th>}
            </tr>
          </thead>
          <tbody>
            {pickListItems.map((line) => (
              <tr key={line.id}>
                {printOptions.isColumnVisible('description') && <td>{line.description}</td>}
                {printOptions.isColumnVisible('qty') && <td>{line.qty}</td>}
                {printOptions.isColumnVisible('unitPrice') && <td>{line.unitPriceEur != null ? formatEur(Number(line.unitPriceEur)) : '—'}</td>}
                {printOptions.isColumnVisible('lineTotal') && <td>{line.lineTotalEur != null ? formatEur(Number(line.lineTotalEur)) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-8 text-xs">{tp('issuedBy')}: ____________________&nbsp;&nbsp;&nbsp;&nbsp;{tp('receivedBy')}: ____________________</p>
      </PrintArea>
    </>
  );
}
