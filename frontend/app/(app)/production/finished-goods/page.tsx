'use client';

import { FinishedGoodsTable } from '@/components/domain/production/finished-goods-table';
import { ReceivePurchasedFinishedGoodsDialog } from '@/components/domain/production/receive-purchased-finished-goods-dialog';
import { useHasPermission } from '@/lib/hooks/use-roles';

export default function FinishedGoodsPage() {
  const canReceivePurchased = useHasPermission('finished-goods:manage');

  return (
    <div className="space-y-4">
      {canReceivePurchased && (
        <div className="flex justify-end">
          <ReceivePurchasedFinishedGoodsDialog />
        </div>
      )}
      <FinishedGoodsTable />
    </div>
  );
}
