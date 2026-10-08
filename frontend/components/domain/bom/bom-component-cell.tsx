'use client';

import { useProduct } from '@/lib/hooks/use-catalog';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';
import type { ComponentType } from '@/lib/api-client/bom';

/** The subset of CostBreakdownLine/WeightBreakdownLine this cell actually needs — both satisfy it structurally. */
export interface BomComponentCellLine {
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
}

/** Resolves a breakdown line's raw productId/subAssemblyId to a real name/article/photo — shared by the cost and weight breakdown tables (originally written once for /cost, duplicated identically when /weight was added, so pulled out here instead of drifting apart). */
export function BomComponentCell({ line }: { line: BomComponentCellLine }) {
  const { data: product } = useProduct(line.componentType === 'PRODUCT' ? line.productId : undefined);
  const { data: subAssembly } = useAssembly(line.componentType === 'ASSEMBLY' ? line.subAssemblyId : undefined);
  const photoEntityIds = line.componentType === 'PRODUCT' ? (line.productId ? [line.productId] : []) : line.subAssemblyId ? [line.subAssemblyId] : [];
  const { data: photos } = useFilesForEntities(
    line.componentType === 'PRODUCT' ? 'Product' : 'Assembly',
    photoEntityIds,
    line.componentType === 'PRODUCT' ? 'PRODUCT_PHOTO' : 'ASSEMBLY_PHOTO',
  );
  const id = line.componentType === 'PRODUCT' ? line.productId : line.subAssemblyId;
  const label =
    line.componentType === 'PRODUCT'
      ? product
        ? `${product.article} — ${product.name}`
        : line.productId
      : subAssembly
        ? `${subAssembly.name}${subAssembly.article ? ` (${subAssembly.article})` : ''}`
        : line.subAssemblyId;
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={id ? photos?.[id]?.[0]?.downloadUrl : undefined} size="sm" />
      <span className="max-w-[280px] truncate" title={label}>{label}</span>
    </div>
  );
}
