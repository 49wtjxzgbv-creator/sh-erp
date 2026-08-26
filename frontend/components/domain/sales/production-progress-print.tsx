'use client';

import { useTranslations } from 'next-intl';
import { useItemProductionTree } from '@/lib/hooks/use-sales';
import type { CustomerOrder, ProductionTreeNode } from '@/lib/api-client/sales';
import type { ProductionOrderStatus } from '@/lib/api-client/production';
import { PrintArea, PrintButton, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';

function ProductionTreePrintNode({ node, depth }: { node: ProductionTreeNode; depth: number }) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');

  return (
    <div style={{ marginLeft: depth * 24 }} className="mb-1">
      <p className={depth === 0 ? 'font-semibold' : ''}>
        {node.article ? `${node.article} — ${node.name}` : node.name}
        {' — '}
        {t('subAssemblyNeeded', { qty: node.qtyNeeded })}, {t('subAssemblyInStock', { qty: node.qtyInStock })}
        {' — '}
        <span className={node.done ? 'font-semibold' : ''}>{node.done ? t('productionTreeReady') : t('productionTreeNotReady')}</span>
        {node.batches.length > 0 && ` · ${node.batches.map((b) => tp(`status${b.status as ProductionOrderStatus}`)).join(', ')}`}
      </p>
      {node.children.map((child) => (
        <ProductionTreePrintNode key={child.assemblyId} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

/** One item's full tree, fetched independently — same query useItemProductionTree/ProductionProgressTree already use on screen, just rendered flat for print instead of as collapsible/interactive nodes. */
function ProductionProgressPrintItem({ orderId, itemId }: { orderId: string; itemId: string }) {
  const { data: tree } = useItemProductionTree(orderId, itemId);
  if (!tree) return null;
  return <ProductionTreePrintNode node={tree} depth={0} />;
}

/**
 * "Друк ходу виробництва" (2026-08-27 user request) — every item's full
 * production tree (виріб -> підвироби -> ...) with each node's readiness
 * and any already-planned batch statuses, printable as one document.
 */
export function ProductionProgressPrint({ order }: { order: CustomerOrder }) {
  const tp = useTranslations('print');

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <PrintButton label={tp('printProductionProgress')} />
        <PreviewButton />
      </div>
      <PrintArea>
        <PrintDocumentHeader
          title={tp('productionProgressTitle')}
          subtitle={`${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`}
        />
        {(order.items ?? []).map((item) => (
          <div key={item.id} className="mb-4">
            <ProductionProgressPrintItem orderId={order.id} itemId={item.id} />
          </div>
        ))}
      </PrintArea>
    </>
  );
}
