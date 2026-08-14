'use client';

import { useTranslations } from 'next-intl';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';

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

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'qtyToOrder', label: t('qtyToOrder') },
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
          triggerLabel={tp('printPurchaseRequest')}
        />
        <PreviewButton />
      </div>
      <PrintArea>
        <PrintDocumentHeader title={tp('supplierRequestsTitle')} />
        {printable.map((group, gi) => (
          <div key={group.supplierId ?? `none-${gi}`} className={gi < printable.length - 1 ? 'print-page-break' : ''}>
            <h2 className="mb-2 font-semibold">{tp('requestTo')}: {group.supplierName}</h2>
            <table className="mb-6">
              <thead>
                <tr>
                  <th>#</th>
                  {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
                  {printOptions.isColumnVisible('qtyToOrder') && <th>{t('qtyToOrder')}</th>}
                </tr>
              </thead>
              <tbody>
                {group.lines
                  .filter((l) => l.qty > 0)
                  .map((line, li) => (
                    <tr key={li}>
                      <td>{li + 1}</td>
                      {printOptions.isColumnVisible('description') && <td>{line.description}</td>}
                      {printOptions.isColumnVisible('qtyToOrder') && <td>{line.qty}</td>}
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
