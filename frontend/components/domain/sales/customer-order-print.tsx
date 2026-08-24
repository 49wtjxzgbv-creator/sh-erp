'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly, useAssemblyCost, useAssemblyCosts, useAssembliesByIds } from '@/lib/hooks/use-bom';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { useProductionOrdersByIds } from '@/lib/hooks/use-production';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { toNumber } from '@/lib/api-client/decimal';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import {
  ComponentNameCell,
  ComponentArticleCell,
  useOwnCostLines,
  EMPTY_PRODUCTS_MAP,
  EMPTY_ASSEMBLIES_MAP,
} from '@/components/domain/bom/assembly-spec-print';
import { Avatar } from '@/components/ui/avatar';
import type { CustomerOrder, CustomerOrderItem } from '@/lib/api-client/sales';
import type { CostBreakdownLine } from '@/lib/api-client/bom';

/** Resolves an order line's assembly name — `CustomerOrderItem` only carries a raw `assemblyId` (frontend/README's tracked "raw id, no name" simplification), not acceptable on a document handed to a customer. Takes the caller's already-batch-fetched map (see CustomerOrderPrint) rather than firing its own request per row. */
function AssemblyNameCell({ assemblyId, assembliesById }: { assemblyId: string; assembliesById: Map<string, { name: string; article: string | null }> }) {
  const assembly = assembliesById.get(assemblyId);
  return <>{assembly ? assembly.name : assemblyId}</>;
}

/** Article/SKU as its own cell — printed as a separate column (bolded by the caller), not folded into the name text. */
function AssemblyArticleCell({ assemblyId, assembliesById }: { assemblyId: string; assembliesById: Map<string, { name: string; article: string | null }> }) {
  const assembly = assembliesById.get(assemblyId);
  return <>{assembly?.article ?? ''}</>;
}

/** Same estimated/actual split as the order detail page (app/(app)/sales/[id]/page.tsx) — see that file's EstimatedPriceCell/ActualPriceCell for the full rationale, just rendered as plain <td>s here for the print table. */
function EstimatedPriceCell({ assemblyId, qty }: { assemblyId: string; qty: number }) {
  const t = useTranslations('sales');
  const { data: cost } = useAssemblyCost(assemblyId);
  return <td>{cost ? formatEur(cost.costPerUnit * qty) : t('pricePending')}</td>;
}

/** Sum of `totalLocalCostEur` across every batch behind this line — a line can have several once split (План-графік §1). Mirrors ActualPriceCell in sales/[id]/page.tsx. */
function ActualPriceCell({ batchIds }: { batchIds: string[] }) {
  const t = useTranslations('sales');
  const poResults = useProductionOrdersByIds(batchIds);
  let total = 0;
  let hasActual = false;
  for (const r of poResults) {
    if (r.data?.totalLocalCostEur != null) {
      total += Number(r.data.totalLocalCostEur);
      hasActual = true;
    }
  }
  if (!hasActual) return <td>{t('pricePending')}</td>;
  return <td>{formatEur(total)}</td>;
}

function PrintPriceTotals({
  order,
  items,
  showEstimated,
  showActual,
}: {
  order: CustomerOrder;
  items: CustomerOrderItem[];
  showEstimated: boolean;
  showActual: boolean;
}) {
  const t = useTranslations('sales');
  const costResults = useAssemblyCosts(items.map((i) => i.assemblyId));
  const allBatchIds = items.flatMap((i) => i.quantitySummary?.batches.map((b) => b.id) ?? []);
  const poResults = useProductionOrdersByIds(allBatchIds);

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
  for (const r of poResults) {
    if (r.data?.totalLocalCostEur != null) {
      actualTotal += Number(r.data.totalLocalCostEur);
      hasActual = true;
    }
  }

  // Same fold as the order detail page's own OrderPriceTotals (sales/[id]/page.tsx) — these count toward the total regardless of production progress.
  const extraCostValues = [toNumber(order.deliveryCost), toNumber(order.transportRiggingCost), toNumber(order.otherCost)];
  const extraCostsTotal = extraCostValues.reduce((sum: number, v) => sum + (v ?? 0), 0);
  const hasExtraCosts = extraCostValues.some((v) => v != null);
  if (hasExtraCosts) {
    estimatedTotal += extraCostsTotal;
    hasEstimate = true;
    actualTotal += extraCostsTotal;
    hasActual = true;
  }

  return (
    <p className="mt-2 text-sm">
      {showEstimated && (
        <>
          {t('estimatedTotal')}: {hasEstimate ? formatEur(estimatedTotal) : t('pricePending')}
        </>
      )}
      {showEstimated && showActual && ' · '}
      {showActual && (
        <>
          {t('actualTotal')}: {hasActual ? formatEur(actualTotal) : t('pricePending')}
        </>
      )}
    </p>
  );
}

/**
 * One "X consists of: [table]" block per assembly node in the exploded
 * composition tree, followed by one such block per sub-assembly it uses —
 * in that order (parent's own component table first, then each child's own
 * block), so the printed document reads top-down exactly as asked: "виріб
 * X складається з товарів/підвиробу Y", then right below, "підвиріб Y
 * складається з товарів...", and so on down to raw products. `qty` is
 * already the fully accumulated quantity needed for the *whole order* down
 * this branch (order qty × every ancestor's qtyPerUnit), not a
 * per-parent-unit ratio — that's the actual question being answered
 * ("скільки потрібно"). BOM cycles are rejected at save time
 * (setAssemblyComponents), so the recursion always terminates at product
 * leaves — no depth guard needed here.
 */
function AssemblyCompositionSection({ assemblyId, qty, depth, showPrice }: { assemblyId: string; qty: number; depth: number; showPrice: boolean }) {
  const t = useTranslations('bom');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);
  const { data: cost } = useAssemblyCost(assemblyId);
  const ownCostLines = useOwnCostLines(assembly);

  const productIds = useMemo(() => (cost?.breakdown ?? []).filter((l) => l.componentType === 'PRODUCT' && l.productId).map((l) => l.productId as string), [cost]);
  const subAssemblyIds = useMemo(() => (cost?.breakdown ?? []).filter((l) => l.componentType === 'ASSEMBLY' && l.subAssemblyId).map((l) => l.subAssemblyId as string), [cost]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', subAssemblyIds, 'ASSEMBLY_PHOTO');
  const { data: photosOfThis } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  // One batched request per level for names/articles instead of one per BOM
  // line — a real incident: the individual-request version blew through
  // the global per-client rate limit on a deep/wide real order (150+
  // leaf products), permanently stranding whichever names got 429'd on
  // their raw id. See ComponentNameCell's own header comment.
  const { data: productsById } = useProductsByIds(productIds);
  const { data: subAssembliesById } = useAssembliesByIds(subAssemblyIds);

  if (!assembly || !cost) return null;

  function lineDownloadUrl(line: CostBreakdownLine): string | undefined {
    if (line.componentType === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  const name = `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}`;

  return (
    <div className="mb-4 break-inside-avoid" style={{ marginLeft: depth * 24 }}>
      <div className="mb-1 flex items-center gap-2">
        <Avatar src={photosOfThis?.[assemblyId]?.[0]?.downloadUrl} size="lg" />
        <p className="font-semibold">{depth === 0 ? tp('consistsOfTop', { name, qty }) : tp('consistsOfSub', { name, qty })}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th className="print-photo-col">{tp('photoColumn')}</th>
            <th>{t('article')}</th>
            <th>{t('component')}</th>
            <th>{t('componentType')}</th>
            <th>{t('qty')}</th>
            {showPrice && <th>{t('cost')}</th>}
          </tr>
        </thead>
        <tbody>
          {cost.breakdown.map((line, i) => (
            <tr key={i}>
              <td><Avatar src={lineDownloadUrl(line)} size="lg" /></td>
              <td className="font-bold">
                <ComponentArticleCell line={line} productsById={productsById ?? EMPTY_PRODUCTS_MAP} assembliesById={subAssembliesById ?? EMPTY_ASSEMBLIES_MAP} />
              </td>
              <td>
                <ComponentNameCell line={line} productsById={productsById ?? EMPTY_PRODUCTS_MAP} assembliesById={subAssembliesById ?? EMPTY_ASSEMBLIES_MAP} />
              </td>
              <td>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</td>
              <td>{line.qtyPerUnit * qty}</td>
              {showPrice && <td>{formatEur(line.unitCost * line.qtyPerUnit * qty)}</td>}
            </tr>
          ))}
          {ownCostLines.map((line) => (
            <tr key={`own-${line.key}`}>
              <td />
              <td />
              <td>{line.label}</td>
              <td>{t('componentTypeOwn')}</td>
              <td>{qty}</td>
              {showPrice && <td>{formatEur(line.value * qty)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {showPrice && (
        <p className="mt-1 text-sm">
          {t('cost')}: {formatEur(cost.costPerUnit * qty)}
        </p>
      )}
      {cost.breakdown
        .filter((l): l is CostBreakdownLine & { subAssemblyId: string } => l.componentType === 'ASSEMBLY' && Boolean(l.subAssemblyId))
        .map((l, i) => (
          <AssemblyCompositionSection key={i} assemblyId={l.subAssemblyId} qty={l.qtyPerUnit * qty} depth={depth + 1} showPrice={showPrice} />
        ))}
    </div>
  );
}

/** Prints the customer order document ("Друкувати замовлення" in legacy). */
export function CustomerOrderPrint({ order }: { order: CustomerOrder }) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');
  const tb = useTranslations('bom');

  const assemblyIds = useMemo(() => Array.from(new Set((order.items ?? []).map((i) => i.assemblyId))), [order.items]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  const { data: orderAssembliesById } = useAssembliesByIds(assemblyIds);

  const columns: PrintColumnOption[] = [
    { id: 'assembly', label: t('assembly') },
    { id: 'qty', label: t('qty') },
    { id: 'estimatedPrice', label: t('estimatedPrice') },
    { id: 'actualPrice', label: t('actualPrice') },
    { id: 'composition', label: t('fullComposition') },
    { id: 'compositionPrice', label: tb('cost') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printOrder')}
        />
        <PreviewButton />
      </div>
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
            {toNumber(order.deliveryCost) != null && <tr><td>{t('deliveryCost')}</td><td>{formatEur(toNumber(order.deliveryCost)!)}</td></tr>}
            {toNumber(order.transportRiggingCost) != null && <tr><td>{t('transportRiggingCost')}</td><td>{formatEur(toNumber(order.transportRiggingCost)!)}</td></tr>}
            {toNumber(order.otherCost) != null && <tr><td>{t('otherCost')}</td><td>{formatEur(toNumber(order.otherCost)!)}</td></tr>}
            {order.comment && <tr><td>{t('comment')}</td><td>{order.comment}</td></tr>}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>#</th>
              {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
              {printOptions.isColumnVisible('assembly') && <th>{t('article')}</th>}
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
                {printOptions.isColumnVisible('assembly') && (
                  <td className="font-bold">
                    <AssemblyArticleCell assemblyId={item.assemblyId} assembliesById={orderAssembliesById ?? EMPTY_ASSEMBLIES_MAP} />
                  </td>
                )}
                {printOptions.isColumnVisible('assembly') && (
                  <td>
                    <AssemblyNameCell assemblyId={item.assemblyId} assembliesById={orderAssembliesById ?? EMPTY_ASSEMBLIES_MAP} />
                  </td>
                )}
                {printOptions.isColumnVisible('qty') && <td>{item.qty}</td>}
                {printOptions.isColumnVisible('estimatedPrice') && <EstimatedPriceCell assemblyId={item.assemblyId} qty={Number(item.qty)} />}
                {printOptions.isColumnVisible('actualPrice') && (
                  <ActualPriceCell batchIds={item.quantitySummary?.batches.map((b) => b.id) ?? []} />
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {(printOptions.isColumnVisible('estimatedPrice') || printOptions.isColumnVisible('actualPrice')) && order.items && order.items.length > 0 && (
          <PrintPriceTotals
            order={order}
            items={order.items}
            showEstimated={printOptions.isColumnVisible('estimatedPrice')}
            showActual={printOptions.isColumnVisible('actualPrice')}
          />
        )}
        {printOptions.isColumnVisible('composition') && order.items && order.items.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-base font-semibold">{tp('compositionSectionTitle')}</h2>
            {order.items.map((item) => (
              <AssemblyCompositionSection
                key={item.id}
                assemblyId={item.assemblyId}
                qty={Number(item.qty)}
                depth={0}
                showPrice={printOptions.isColumnVisible('compositionPrice')}
              />
            ))}
          </div>
        )}
      </PrintArea>
    </>
  );
}
