'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useItemProductionTree } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { ProductionTreeNode } from '@/lib/api-client/sales';
import type { ProductionOrderStatus } from '@/lib/api-client/production';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';
import { cn } from '@/lib/utils';

const BATCH_STATUS_VARIANT: Record<ProductionOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

function collectAssemblyIds(node: ProductionTreeNode, into: string[]) {
  into.push(node.assemblyId);
  node.children.forEach((c) => collectAssemblyIds(c, into));
}

function TreeNode({ node, depth, photosByAssembly }: { node: ProductionTreeNode; depth: number; photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined }) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');

  return (
    <div style={{ marginLeft: depth * 28 }} className="space-y-2">
      <div
        className={cn(
          'flex items-center gap-3 rounded-md border p-2',
          node.done ? 'border-success/40 bg-success/10' : 'border-border bg-muted/30',
        )}
      >
        <Avatar src={photosByAssembly?.[node.assemblyId]?.[0]?.downloadUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-medium', node.done && 'text-success-foreground')}>
            {node.article ? `${node.article} — ${node.name}` : node.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('subAssemblyNeeded', { qty: node.qtyNeeded })} · {t('subAssemblyInStock', { qty: node.qtyInStock })}
          </p>
        </div>
        <Badge variant={node.done ? 'success' : 'secondary'}>{node.done ? t('productionTreeReady') : t('productionTreeNotReady')}</Badge>
        {node.batches.map((b) => (
          <Link key={b.id} href={`/production/${b.id}`}>
            <Badge variant={BATCH_STATUS_VARIANT[b.status as ProductionOrderStatus] ?? 'secondary'} className="hover:underline">
              {tp(`status${b.status}`)}
            </Badge>
          </Link>
        ))}
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.assemblyId} node={child} depth={depth + 1} photosByAssembly={photosByAssembly} />
      ))}
    </div>
  );
}

/**
 * "Хід виробництва" (2026-08-25 user request): this order line's full BOM
 * as an actual parent -> child chain — цей виріб складається з цього
 * підвиробу, цей підвиріб складається з цих підвиробів, і т.д. — with
 * what's already IN_STOCK lit up green and what still needs producing left
 * grey, plus any already-planned batches (from "Дати в виробництво" or the
 * sub-assembly planning dialog at order creation) linked inline. The point
 * is purely orientational: what to start next, what's already covered.
 */
export function ProductionProgressTree({ orderId, itemId }: { orderId: string; itemId: string }) {
  const t = useTranslations('sales');
  const { data: tree, isLoading } = useItemProductionTree(orderId, itemId);

  const assemblyIds = useMemo(() => {
    if (!tree) return [];
    const ids: string[] = [];
    collectAssemblyIds(tree, ids);
    return ids;
  }, [tree]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  if (isLoading) return <LoadingBlock />;
  if (!tree) return null;
  if (tree.children.length === 0) {
    // A leaf item (no sub-assemblies) still shows its own readiness — same
    // node rendering, just nothing to indent under it.
    return <TreeNode node={tree} depth={0} photosByAssembly={photosByAssembly} />;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('productionTreeDescription')}</p>
      <TreeNode node={tree} depth={0} photosByAssembly={photosByAssembly} />
    </div>
  );
}
