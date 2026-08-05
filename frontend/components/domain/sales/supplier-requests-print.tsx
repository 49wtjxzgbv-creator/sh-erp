'use client';

import { useTranslations } from 'next-intl';
import { PrintArea, PrintButton, PrintDocumentHeader } from '@/components/domain/print/print-area';

export interface SupplierRequestGroupForPrint {
  supplierId?: string;
  supplierName: string;
  lines: { description: string; qty: number }[];
}

/**
 * Prints the supplier-grouped shortage preview as a set of purchase-request
 * documents ("Заявки постачальникам" in legacy) — one table per supplier,
 * a page break between suppliers, matching the legacy layout. Uses the
 * page's own live `groups` state (the qty the user has actually typed in,
 * not the raw preview) so what prints matches what "Create purchase orders"
 * would actually submit. `ShortageLine` has no photo/expectedPrice field in
 * this backend (`lib/api-client/sales.ts` — confirmed, unlike the legacy
 * sheet's per-line photo+price columns) — omitted here, disclosed rather
 * than faked, same scope boundary as the customer order print.
 */
export function SupplierRequestsPrint({ groups }: { groups: SupplierRequestGroupForPrint[] }) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');
  const printable = groups.filter((g) => g.lines.some((l) => l.qty > 0));

  return (
    <>
      <PrintButton label={tp('printPurchaseRequest')} />
      <PrintArea>
        <PrintDocumentHeader title={tp('supplierRequestsTitle')} />
        {printable.map((group, gi) => (
          <div key={group.supplierId ?? `none-${gi}`} className={gi < printable.length - 1 ? 'print-page-break' : ''}>
            <h2 className="mb-2 font-semibold">{tp('requestTo')}: {group.supplierName}</h2>
            <table className="mb-6">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('description')}</th>
                  <th>{t('qtyToOrder')}</th>
                </tr>
              </thead>
              <tbody>
                {group.lines
                  .filter((l) => l.qty > 0)
                  .map((line, li) => (
                    <tr key={li}>
                      <td>{li + 1}</td>
                      <td>{line.description}</td>
                      <td>{line.qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </PrintArea>
    </>
  );
}
