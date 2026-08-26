'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useItemProductionTree, useGiveItemToProduction, useGiveSubAssemblyToProduction } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { ProductionTreeNode } from '@/lib/api-client/sales';
import type { ProductionOrderStatus } from '@/lib/api-client/production';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
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

/**
 * Per-node "Передати у виробництво" (2026-08-27 user request) — replaces
 * the old upfront-at-creation sub-assembly planning dialog: nothing is
 * planned by default anymore, every node of the tree (the item itself AND
 * every sub-assembly at any depth) gets its own button here instead. The
 * root node (isRoot) reuses the exact same action the Items table's own
 * "Передати у виробництво" button already calls (giveItemToProduction);
 * every other node calls the new per-node endpoint
 * (giveSubAssemblyToProduction), linked via subAssemblyForItemId.
 */
function GiveNodeToProductionButton({
  orderId,
  itemId,
  node,
  isRoot,
}: {
  orderId: string;
  itemId: string;
  node: ProductionTreeNode;
  isRoot: boolean;
}) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const giveItem = useGiveItemToProduction(orderId);
  const giveSubAssembly = useGiveSubAssemblyToProduction(orderId);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  const defaultQty = Math.max(1, Math.ceil(node.qtyNeeded - node.qtyInStock) || Math.ceil(node.qtyNeeded));
  const pending = giveItem.isPending || giveSubAssembly.isPending;

  async function handleConfirm() {
    setError(null);
    const parsedQty = qty ? Number(qty) : defaultQty;
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      setError(t('invalidGiveToProduction'));
      return;
    }
    try {
      if (isRoot) {
        await giveItem.mutateAsync({ itemId, dto: { unitsPlanned: parsedQty } });
      } else {
        await giveSubAssembly.mutateAsync({ itemId, dto: { assemblyId: node.assemblyId, qty: parsedQty } });
      }
      setOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setQty(String(defaultQty)); setError(null); } }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" onClick={(e) => e.stopPropagation()}>
          {t('giveToProduction')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('giveToProductionDialogTitle')}</DialogTitle>
          <DialogDescription>{t('giveToProductionDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`node-qty-${node.assemblyId}`}>{t('batchQty')}</Label>
          <Input id={`node-qty-${node.assemblyId}`} type="number" step="1" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          <Button loading={pending} onClick={handleConfirm}>
            {tc('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreeNode({
  node,
  depth,
  orderId,
  itemId,
  canManage,
  photosByAssembly,
}: {
  node: ProductionTreeNode;
  depth: number;
  orderId: string;
  itemId: string;
  canManage: boolean;
  photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined;
}) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');

  // Capped + smaller-than-before step so a deep chain (4+ levels, seen on
  // real BOMs) doesn't eat most of a phone's width before any content even
  // renders — indentation past level 6 stops growing, it's already
  // unambiguous which branch is whose by then.
  const indent = Math.min(depth, 6) * 16;

  return (
    <div style={{ marginLeft: indent }} className="space-y-2">
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border p-2',
          node.done ? 'border-success/40 bg-success/10' : 'border-border bg-muted/30',
        )}
      >
        <Avatar src={photosByAssembly?.[node.assemblyId]?.[0]?.downloadUrl} size="md" />
        <div className="min-w-0 flex-1 basis-40">
          <p className={cn('truncate text-sm font-medium', node.done && 'text-success-foreground')}>
            {node.article ? `${node.article} — ${node.name}` : node.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('subAssemblyNeeded', { qty: node.qtyNeeded })} · {t('subAssemblyInStock', { qty: node.qtyInStock })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={node.done ? 'success' : 'secondary'}>{node.done ? t('productionTreeReady') : t('productionTreeNotReady')}</Badge>
          {node.batches.map((b) => (
            <Link key={b.id} href={`/production/${b.id}`}>
              <Badge variant={BATCH_STATUS_VARIANT[b.status as ProductionOrderStatus] ?? 'secondary'} className="hover:underline">
                {tp(`status${b.status}`)}
              </Badge>
            </Link>
          ))}
          {!node.done && canManage && <GiveNodeToProductionButton orderId={orderId} itemId={itemId} node={node} isRoot={depth === 0} />}
        </div>
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.assemblyId} node={child} depth={depth + 1} orderId={orderId} itemId={itemId} canManage={canManage} photosByAssembly={photosByAssembly} />
      ))}
    </div>
  );
}

/**
 * "Хід виробництва" (2026-08-25 user request): this order line's full BOM
 * as an actual parent -> child chain — цей виріб складається з цього
 * підвиробу, цей підвиріб складається з цих підвиробів, і т.д. — with
 * what's already IN_STOCK lit up green and what still needs producing left
 * grey, plus any already-planned batches linked inline. Nothing is planned
 * automatically anymore (2026-08-27): every node, at any depth, carries its
 * own "Передати у виробництво" button (GiveNodeToProductionButton) so staff
 * decide what to actually start, one node at a time, straight from this
 * tree — replacing the old upfront-at-order-creation planning dialog.
 */
export function ProductionProgressTree({ orderId, itemId }: { orderId: string; itemId: string }) {
  const t = useTranslations('sales');
  const canManage = useHasPermission('customer-orders:manage');
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
    return <TreeNode node={tree} depth={0} orderId={orderId} itemId={itemId} canManage={canManage} photosByAssembly={photosByAssembly} />;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('productionTreeDescription')}</p>
      <TreeNode node={tree} depth={0} orderId={orderId} itemId={itemId} canManage={canManage} photosByAssembly={photosByAssembly} />
    </div>
  );
}
