'use client';

import { useTranslations } from 'next-intl';
import { useAssembly, useAssemblyCost } from '@/lib/hooks/use-bom';
import { useProduct } from '@/lib/hooks/use-catalog';
import { PrintArea, PrintButton, PrintDocumentHeader } from '@/components/domain/print/print-area';
import type { CostBreakdownLine } from '@/lib/api-client/bom';

/**
 * Resolves a single BOM line's component name for the print layout —
 * `AssemblyComponent`/`CostBreakdownLine` only ever carry raw `productId`/
 * `subAssemblyId` (the same "known simplification" tracked across
 * Inventory/BOM/Production/Procurement/Sales in frontend/README.md), which
 * is fine for an on-screen table with a tooltip but not acceptable on a
 * printed shop-floor document. Resolved via the same `useProduct`/
 * `useAssembly` hooks every other page already uses — no new backend
 * endpoint, just paid for here instead of deferred to a raw-id table cell.
 */
function ComponentNameCell({ line }: { line: CostBreakdownLine }) {
  const { data: product } = useProduct(line.componentType === 'PRODUCT' ? line.productId : undefined);
  const { data: subAssembly } = useAssembly(line.componentType === 'ASSEMBLY' ? line.subAssemblyId : undefined);
  if (line.componentType === 'PRODUCT') return <>{product ? `${product.article} — ${product.name}` : line.productId}</>;
  return <>{subAssembly ? `${subAssembly.name} [${subAssembly.article ?? ''}]` : line.subAssemblyId}</>;
}

export function AssemblySpecPrint({ assemblyId }: { assemblyId: string }) {
  const t = useTranslations('bom');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);
  const { data: cost } = useAssemblyCost(assemblyId);

  if (!assembly || !cost) return <PrintButton label={tp('printSpecification')} className="opacity-50" />;

  return (
    <>
      <PrintButton label={tp('printSpecification')} />
      <PrintArea>
        <PrintDocumentHeader
          title={tp('specificationTitle')}
          subtitle={`${assembly.article ?? ''} ${assembly.name}`}
        />
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('component')}</th>
              <th>{t('componentType')}</th>
              <th>{t('qtyPerUnit')}</th>
              <th>{t('localCost')}</th>
              <th>{t('germanCost')}</th>
            </tr>
          </thead>
          <tbody>
            {cost.breakdown.map((line, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><ComponentNameCell line={line} /></td>
                <td>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</td>
                <td>{line.qtyPerUnit}</td>
                <td>{line.lineLocalCost.toFixed(2)}</td>
                <td>{line.lineGermanCost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm font-semibold">
          {t('localCost')}: {cost.localCostPerUnit.toFixed(2)} EUR / {tp('units').toLowerCase()} &nbsp;·&nbsp;
          {t('germanCost')}: {cost.germanCostPerUnit.toFixed(2)} EUR / {tp('units').toLowerCase()}
        </p>
      </PrintArea>
    </>
  );
}
