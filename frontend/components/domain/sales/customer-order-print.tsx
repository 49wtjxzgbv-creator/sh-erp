'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { PrintArea, PrintDocumentHeader } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { Avatar } from '@/components/ui/avatar';
import type { CustomerOrder } from '@/lib/api-client/sales';

/** Resolves an order line's assembly name — `CustomerOrderItem` only carries a raw `assemblyId` (frontend/README's tracked "raw id, no name" simplification), not acceptable on a document handed to a customer. */
function AssemblyNameCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return <>{assembly ? `${assembly.article ?? ''} ${assembly.name}` : assemblyId}</>;
}

/**
 * Prints the customer order document ("Друкувати замовлення" in legacy).
 * `CustomerOrderItem` has no unit-cost/line-total field in this backend at
 * all (confirmed against `lib/api-client/sales.ts` — only `assemblyId`/
 * `qty`/`productionOrderId`), unlike the legacy sheet which showed cost
 * columns for admins. Reproducing pricing here would need a new backend
 * field (e.g. freezing a unit price on `CustomerOrderItem` at order-creation
 * time, which doesn't exist), out of scope for this pass — this prints
 * client/order header + line items (assembly + qty), disclosed as a
 * deliberate scope boundary rather than a silent omission.
 */
export function CustomerOrderPrint({ order }: { order: CustomerOrder }) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');

  const assemblyIds = useMemo(() => Array.from(new Set((order.items ?? []).map((i) => i.assemblyId))), [order.items]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  const columns: PrintColumnOption[] = [
    { id: 'assembly', label: t('assembly') },
    { id: 'qty', label: t('qty') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  return (
    <>
      <PrintOptionsDialog
        open={printOptions.open}
        onOpenChange={printOptions.setOpen}
        columns={columns}
        hasPhotos
        onConfirm={printOptions.confirm}
        triggerLabel={tp('printOrder')}
      />
      <PrintArea>
        <PrintDocumentHeader
          title={tp('customerOrderTitle')}
          subtitle={`${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`}
        />
        <table className="mb-4">
          <tbody>
            <tr><td>{t('contactPerson')}</td><td>{order.contactPerson ?? '—'}</td></tr>
            <tr><td>{t('deadline')}</td><td>{order.deadline ? new Date(order.deadline).toLocaleDateString() : '—'}</td></tr>
            <tr><td>{t('priority')}</td><td>{t(`priority${order.priority}`)}</td></tr>
            {order.comment && <tr><td>{t('comment')}</td><td>{order.comment}</td></tr>}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>#</th>
              {printOptions.includePhotos && <th>{tp('photoColumn')}</th>}
              {printOptions.isColumnVisible('assembly') && <th>{t('assembly')}</th>}
              {printOptions.isColumnVisible('qty') && <th>{t('qty')}</th>}
            </tr>
          </thead>
          <tbody>
            {(order.items ?? []).map((item, i) => (
              <tr key={item.id}>
                <td>{i + 1}</td>
                {printOptions.includePhotos && (
                  <td>
                    <Avatar src={photosByAssembly?.[item.assemblyId]?.[0]?.downloadUrl} size="lg" />
                  </td>
                )}
                {printOptions.isColumnVisible('assembly') && <td><AssemblyNameCell assemblyId={item.assemblyId} /></td>}
                {printOptions.isColumnVisible('qty') && <td>{item.qty}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </PrintArea>
    </>
  );
}
