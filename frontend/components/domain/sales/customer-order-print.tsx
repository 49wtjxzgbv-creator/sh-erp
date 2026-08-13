'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly, useAssemblyCost, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useProductionOrder, useProductionOrdersByIds } from '@/lib/hooks/use-production';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { ComponentNameCell } from '@/components/domain/bom/assembly-spec-print';
import { Avatar } from '@/components/ui/avatar';
import type { CustomerOrder, CustomerOrderItem } from '@/lib/api-client/sales';
import type { CostBreakdownLine } from '@/lib/api-client/bom';

/** Resolves an order line's assembly name — `CustomerOrderItem` only carries a raw `assemblyId` (frontend/README's tracked "raw id, no name" simplification), not acceptable on a document handed to a customer. */
function AssemblyNameCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return <>{assembly ? `${assembly.article ?? ''} ${assembly.name}` : assemblyId}</>;
}

/** Same estimated/actual split as the order detail page (app/(app)/sales/[id]/page.tsx) — see that file's EstimatedPriceCell/ActualPriceCell for the full rationale, just rendered as plain <td>s here for the print table. */
function EstimatedPriceCell({ assemblyId, qty }: { assemblyId: string; qty: number }) {
  const t = useTranslations('sales');
  const { data: cost } = useAssemblyCost(assemblyId);
  return <td>{cost ? formatEur(cost.costPerUnit * qty) : t('pricePending')}</td>;
}

function ActualPriceCell({ productionOrderId }: { productionOrderId: string | null }) {
  const t = useTranslations('sales');
  const { data: po } = useProductionOrder(productionOrderId ?? undefined);
  if (!productionOrderId || !po || po.totalLocalCostEur == null) return <td>{t('pricePending')}</td>;
  return <td>{formatEur(Number(po.totalLocalCostEur))}</td>;
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
      {t('estimatedTotal')}: {hasEstimate ? formatEur(estimatedTotal) : t('pricePending')}
      {' · '}
      {t('actualTotal')}: {hasActual ? formatEur(actualTotal) : t('pricePending')}
    </p>
  );
}

/**
 * One row of the exploded composition tree — a product leaf, or a
 * sub-assembly whose own components recurse via <BomTreeRows> right below
 * it, indented one level deeper. `qtyMultiplier` is already the fully
 * accumulated quantity needed for the *whole order* down this branch (order
 * qty × every ancestor's qtyPerUnit), not just this line's own qtyPerUnit —
 * that's the actual question being answered ("скільки потрібно"), not a
 * per-parent-unit ratio.
 */
function BomTreeLine({ line, qtyMultiplier, depth }: { line: CostBreakdownLine; qtyMultiplier: number; depth: number }) {
  const t = useTranslations('bom');
  const totalQty = line.qtyPerUnit * qtyMultiplier;
  return (
    <>
      <tr>
        <td style={{ paddingLeft: `${depth * 16}px` }}><ComponentNameCell line={line} /></td>
        <td>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</td>
        <td>{totalQty}</td>
      </tr>
      {line.componentType === 'ASSEMBLY' && line.subAssemblyId && (
        <BomTreeRows assemblyId={line.subAssemblyId} qtyMultiplier={totalQty} depth={depth + 1} />
      )}
    </>
  );
}

/** BOM cycles are rejected at save time (setAssemblyComponents), so this recursion always terminates at product leaves — no depth guard needed here. */
function BomTreeRows({ assemblyId, qtyMultiplier, depth }: { assemblyId: string; qtyMultiplier: number; depth: number }) {
  const { data: cost } = useAssemblyCost(assemblyId);
  if (!cost) return null;
  return (
    <>
      {cost.breakdown.map((line, i) => (
        <BomTreeLine key={i} line={line} qtyMultiplier={qtyMultiplier} depth={depth} />
      ))}
    </>
  );
}

/** Full exploded composition for one order line — the assembly itself, then every product/sub-assembly it needs, recursively, so the printed document shows what the order actually consists of down to raw products (not just the ordered assemblies). */
function OrderItemComposition({ item }: { item: CustomerOrderItem }) {
  const t = useTranslations('bom');
  const { data: assembly } = useAssembly(item.assemblyId);
  return (
    <div className="mb-4">
      <p className="mb-1 font-semibold">
        {assembly ? `${assembly.article ?? ''} ${assembly.name}` : item.assemblyId} — {item.qty} {t('qty').toLowerCase()}
      </p>
      <table>
        <thead>
          <tr>
            <th>{t('component')}</th>
            <th>{t('componentType')}</th>
            <th>{t('qty')}</th>
          </tr>
        </thead>
        <tbody>
          <BomTreeRows assemblyId={item.assemblyId} qtyMultiplier={Number(item.qty)} depth={0} />
        </tbody>
      </table>
    </div>
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
    { id: 'composition', label: t('fullComposition') },
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
        {printOptions.isColumnVisible('composition') && order.items && order.items.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-base font-semibold">{tp('compositionSectionTitle')}</h2>
            {order.items.map((item) => (
              <OrderItemComposition key={item.id} item={item} />
            ))}
          </div>
        )}
      </PrintArea>
    </>
  );
}
