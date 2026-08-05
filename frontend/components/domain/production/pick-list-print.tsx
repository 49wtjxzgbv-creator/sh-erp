'use client';

import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { PrintArea, PrintButton, PrintDocumentHeader } from '@/components/domain/print/print-area';
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

  return (
    <>
      <PrintButton label={tp('printPickList')} />
      <PrintArea>
        <PrintDocumentHeader
          title={tp('pickListTitle')}
          subtitle={`${assembly?.name ?? assemblyId} — ${unitsPlanned} ${tp('units')} — ${tp('orderId')} ${orderId.slice(0, 8)}`}
        />
        <table>
          <thead>
            <tr>
              <th>{t('description')}</th>
              <th>{t('qty')}</th>
              <th>{t('unitPrice')}</th>
              <th>{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {pickListItems.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.qty}</td>
                <td>{line.unitPriceEur ?? '—'}</td>
                <td>{line.lineTotalEur ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-8 text-xs">{tp('issuedBy')}: ____________________&nbsp;&nbsp;&nbsp;&nbsp;{tp('receivedBy')}: ____________________</p>
      </PrintArea>
    </>
  );
}
