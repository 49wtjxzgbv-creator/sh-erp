'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { ResolvedProductSupplier } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { formatEur } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';

export interface SuppliersCellProps {
  entityId: string;
  entityName: string;
  suppliers: ResolvedProductSupplier[];
  supplierById: Map<string, string>;
}

/**
 * Compact "all linked suppliers + prices" summary for one products-table
 * row, with an edit button opening the same `EntitySuppliersEditor` the
 * product detail page uses — lets staff add/change suppliers and prices
 * straight from the Catalog list/grid, not just after navigating in.
 * `stopPropagation` on the button matters here: both host tables put a
 * row-level onClick (navigate to the product) on the `<tr>`, and this cell
 * sits inside it.
 */
export function SuppliersCell({ entityId, entityName, suppliers, supplierById }: SuppliersCellProps) {
  const [open, setOpen] = useState(false);

  const summary =
    suppliers.length === 0
      ? '—'
      : suppliers
          .map((s) => {
            const name = supplierById.get(s.supplierId) ?? '—';
            const price = toNumber(s.price);
            return `${name}${s.isDefault ? ' ★' : ''}${price != null ? `: ${formatEur(price)}` : ''}`;
          })
          .join(', ');

  return (
    <div className="flex items-center gap-1.5">
      <span className="max-w-[220px] truncate text-sm" title={summary}>
        {summary}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{entityName}</DialogTitle>
          </DialogHeader>
          <EntitySuppliersEditor entityType="Product" entityId={entityId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
