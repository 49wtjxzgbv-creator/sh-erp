'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { useItemProductionTree } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { CustomerOrder, CustomerOrderItem, ProductionTreeNode } from '@/lib/api-client/sales';
import type { ProductionOrderStatus } from '@/lib/api-client/production';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions } from '@/components/domain/print/print-options';
import { BATCH_STATUS_VARIANT, collectAssemblyIds } from '@/components/domain/sales/production-progress-tree';
import { AssemblyCell } from '@/components/domain/sales/assembly-cell';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Same card look as the on-screen TreeNode (production-progress-tree.tsx) — border/background by readiness, photo, name, needed/in-stock, status badges — just without the interactive Link/button, since a printed page has nothing to click. */
function ProductionTreePrintNode({
  node,
  depth,
  photosByAssembly,
}: {
  node: ProductionTreeNode;
  depth: number;
  photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined;
}) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');
  const indent = Math.min(depth, 6) * 16;

  return (
    <div style={{ marginLeft: indent }} className="mb-2">
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border p-2',
          node.done ? 'border-success/40 bg-success/10' : 'border-border bg-muted/30',
        )}
      >
        <Avatar src={photosByAssembly?.[node.assemblyId]?.[0]?.downloadUrl} size="md" zoomable={false} />
        <div className="min-w-0 flex-1 basis-40">
          <p className={cn('truncate text-sm font-medium', node.done && 'text-success-foreground')}>
            {node.article ? `${node.article} — ${node.name}` : node.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('subAssemblyNeeded', { qty: node.qtyNeeded })} · {t('subAssemblyInStock', { qty: node.qtyInStock })} ·{' '}
            {t('subAssemblyProduced', { qty: node.produced })} ·{' '}
            {t('subAssemblyRemaining', { qty: Math.max(node.qtyNeeded - node.produced, 0) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={node.done ? 'success' : 'secondary'}>{node.done ? t('productionTreeReady') : t('productionTreeNotReady')}</Badge>
          {node.batches.map((b) => (
            <Badge key={b.id} variant={BATCH_STATUS_VARIANT[b.status as ProductionOrderStatus] ?? 'secondary'}>
              {tp(`status${b.status}`)}
            </Badge>
          ))}
        </div>
      </div>
      {node.children.map((child) => (
        <ProductionTreePrintNode key={child.assemblyId} node={child} depth={depth + 1} photosByAssembly={photosByAssembly} />
      ))}
    </div>
  );
}

/** One item's emphasized heading + full tree, fetched independently — same query useItemProductionTree/ProductionProgressTree already use on screen, same emphasized-heading-then-tree layout, just non-interactive for print. */
function ProductionProgressPrintItem({ orderId, item }: { orderId: string; item: CustomerOrderItem }) {
  const { data: tree } = useItemProductionTree(orderId, item.id);
  const assemblyIds = useMemo(() => {
    if (!tree) return [];
    const ids: string[] = [];
    collectAssemblyIds(tree, ids);
    return ids;
  }, [tree]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  if (!tree) return null;
  return (
    <div className="mb-6">
      <div className="mb-2 rounded-md border-2 border-primary/40 bg-primary/5 p-3">
        <AssemblyCell assemblyId={item.assemblyId} size="lg" textClassName="text-base font-semibold" />
      </div>
      <ProductionTreePrintNode node={tree} depth={0} photosByAssembly={photosByAssembly} />
    </div>
  );
}

/**
 * "Друк ходу виробництва" (2026-08-27 user request) — every item's full
 * production tree (виріб -> підвироби -> ...) with each node's readiness
 * and any already-planned batch statuses, printed with the same visual
 * card layout as the on-screen tree, not a plain text list.
 *
 * `usePrintOptions`/`printAreaId` with an empty column list (no per-column
 * toggle makes sense for this view — the whole tree always prints) — still
 * needed for the activate-only-this-print-area + wait-for-fetch behavior,
 * since this order page hosts several other `<PrintArea>`s at once
 * (CustomerOrderPrint, PayrollFundEstimatePrint, ProfitReportPrint). A plain
 * `PrintButton`/`window.print()` here left every one of them
 * `print-area--active` simultaneously — real reported bug (2026-09-11: "не
 * друкує сам звіт", found via ProfitReportPrint but equally present here —
 * see print-options.tsx's own header comment for the original 2026-08-25
 * regression this same fix pattern addresses).
 */
export function ProductionProgressPrint({ order }: { order: CustomerOrder }) {
  const tp = useTranslations('print');
  const printOptions = usePrintOptions({ columns: [] });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => printOptions.confirm(new Set(), false)}>
          <Printer className="mr-2 h-4 w-4" />
          {tp('printProductionProgress')}
        </Button>
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader
          title={tp('productionProgressTitle')}
          subtitle={`${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`}
        />
        {(order.items ?? []).map((item) => (
          <ProductionProgressPrintItem key={item.id} orderId={order.id} item={item} />
        ))}
      </PrintArea>
    </>
  );
}
