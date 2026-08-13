'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly, useAssemblyCost, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useProductionOrder, useProductionOrdersByIds } from '@/lib/hooks/use-production';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { PrintArea, PrintDocumentHeader } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { Avatar } from '@/components/ui/avatar';
import type { CustomerOrder, CustomerOrderItem } from '@/lib/api-client/sales';

/** Resolves an order line's assembly name — `CustomerOrderItem` only carries a raw `assemblyId` (frontend/README's tracked "raw id, no name" simplification), not acceptable on a document handed to a customer. */
function AssemblyNameCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return <>{assembly ? `${assembly.article ?? ''} ${assembly.name}` : assemblyId}</>;
}

/** Same estimated/actual split as the order detail page (app/(app)/sales/[id]/page.tsx) — see that file's EstimatedPriceCell/ActualPriceCell for the full rationale, just rendered as plain <td>s here for the print table. */
function EstimatedPriceCell({ assemblyId, qty }: { assemblyId: string; qty: number }) {
  const t = useTranslations('sales');
  const { data: cost } = useAssemblyCost(assemblyId);
  return <td>{cost ? (cost.costPerUnit * qty).toFixed(2) : t('pricePending')}</td>;
}

function ActualPriceCell({ productionOrderId }: { productionOrderId: string | null }) {
  const t = useTranslations('sales');
  const { data: po } = useProductionOrder(productionOrderId ?? undefined);
  if (!productionOrderId || !po || po.totalLocalCostEur == null) return <td>{t('pricePending')}</td>;
  return <td>{Number(po.totalLocalCostEur).toFixed(2)}</td>;
}

function PrintPriceTotals({ items }: { items: CustomerOrderItem[] }) {
  const t = useTranslations('sales');
  const costResults = useAssemblyCosts(items.map((i) => i.assemblyId));
  const poResults = useProductionOrdersByIds(items.map((i) => i.productionOrderId ?? undefined));

  let estimatedTotal = 0;
  let hasEstimate = false;
  items.forEach((item, i) => {
    const cost = costResults[i]?.data;
    if (cost) {
      estimatedTotal += cost.costPerUnit * Number(item.qty);
      hasEstimate = true;
    }
  });

  let actualTotal = 0;
  let hasActual = false;
  items.forEach((item, i) => {
    const po = poResults[i]?.data;
    if (po?.totalLocalCostEur != null) {
      actualTotal += Number(po.totalLocalCostEur);
      hasActual = true;
    }
  });

  return (
    <p className="mt-2 text-sm">
      {t('estimatedTotal')}: {hasEstimate ? estimatedTotal.toFixed(2) : t('pricePending')}
      {' · '}
      {t('actualTotal')}: {hasActual ? actualTotal.toFixed(2) : t('pricePending')}
    </p>
  );
}

/** Prints the customer order document ("Друкувати замовлення" in legacy). */
export function CustomerOrderPrint({ order }: { order: CustomerOrder }) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');

  const assemblyIds = useMemo(() => Array.from(new Set((order.items ?? []).map((i) => i.assemblyId))), [order.items]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  const columns: PrintColumnOption[] = [
    { id: 'assembly', label: t('assembly') },
    { id: 'qty', label: t('qty') },
    { id: 'estimatedPrice', label: t('estimatedPrice') },
    { id: 'actualPrice', label: t('actualPrice') },
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
              {printOptions.isColumnVisible('estimatedPrice') && <th>{t('estimatedPrice')}</th>}
              {printOptions.isColumnVisible('actualPrice') && <th>{t('actualPrice')}</th>}
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
                {printOptions.isColumnVisible('estimatedPrice') && <EstimatedPriceCell assemblyId={item.assemblyId} qty={Number(item.qty)} />}
                {printOptions.isColumnVisible('actualPrice') && <ActualPriceCell productionOrderId={item.productionOrderId} />}
              </tr>
            ))}
          </tbody>
        </table>
        {(printOptions.isColumnVisible('estimatedPrice') || printOptions.isColumnVisible('actualPrice')) && order.items && order.items.length > 0 && (
          <PrintPriceTotals items={order.items} />
        )}
      </PrintArea>
    </>
  );
}
