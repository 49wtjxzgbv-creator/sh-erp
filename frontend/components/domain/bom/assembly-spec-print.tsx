'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly, useAssemblyCost, useAssembliesByIds } from '@/lib/hooks/use-bom';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { Avatar } from '@/components/ui/avatar';
import type { CostBreakdownLine, Assembly } from '@/lib/api-client/bom';
import type { Product } from '@/lib/api-client/catalog';

export const EMPTY_PRODUCTS_MAP: Map<string, Product> = new Map();
export const EMPTY_ASSEMBLIES_MAP: Map<string, Assembly> = new Map();

/**
 * Resolves a single BOM line's component name for the print layout —
 * `AssemblyComponent`/`CostBreakdownLine` only ever carry raw `productId`/
 * `subAssemblyId` (the same "known simplification" tracked across
 * Inventory/BOM/Production/Procurement/Sales in frontend/README.md), which
 * is fine for an on-screen table with a tooltip but not acceptable on a
 * printed shop-floor document. Takes already-batch-fetched maps rather
 * than resolving its own id via useProduct/useAssembly — a real incident:
 * one request per line (this cell used to call useProduct/useAssembly
 * itself) blew straight through the global per-client rate limit on a
 * customer order whose full composition print touched 150+ products,
 * leaving whichever names got 429'd permanently stuck on the raw id (same
 * failure mode already fixed once for bulk product delete — see
 * ProductsService#bulkRemove's own header comment). The caller now does
 * one batched useProductsByIds/useAssembliesByIds call per BOM level
 * instead.
 */
export function ComponentNameCell({
  line,
  productsById,
  assembliesById,
}: {
  line: CostBreakdownLine;
  productsById: Map<string, Product>;
  assembliesById: Map<string, Assembly>;
}) {
  if (line.componentType === 'PRODUCT') {
    const product = line.productId ? productsById.get(line.productId) : undefined;
    return <>{product ? product.name : line.productId}</>;
  }
  const subAssembly = line.subAssemblyId ? assembliesById.get(line.subAssemblyId) : undefined;
  return <>{subAssembly ? subAssembly.name : line.subAssemblyId}</>;
}

/** Article/SKU as its own cell — printed as a separate column (bolded by the caller), not folded into the name text. */
export function ComponentArticleCell({
  line,
  productsById,
  assembliesById,
}: {
  line: CostBreakdownLine;
  productsById: Map<string, Product>;
  assembliesById: Map<string, Assembly>;
}) {
  if (line.componentType === 'PRODUCT') {
    const product = line.productId ? productsById.get(line.productId) : undefined;
    return <>{product?.article ?? ''}</>;
  }
  const subAssembly = line.subAssemblyId ? assembliesById.get(line.subAssemblyId) : undefined;
  return <>{subAssembly?.article ?? ''}</>;
}

/**
 * The four "own" per-unit cost fields on Assembly (labor/packaging/
 * delivery/other) are already folded into `AssemblyCostResult.costPerUnit`
 * by the backend (assemblies.service.ts#calcAssemblyCostRecursive: `let
 * costPerUnit = ownCost; ...`), but `breakdown` only ever lists
 * PRODUCT/ASSEMBLY component lines — never a line for these four fields.
 * Print it as an itemized breakdown or the visible rows silently don't sum
 * to the printed total, and any labor/packaging/etc a shop actually set on
 * the assembly is invisible on the printed document even though it's being
 * charged for. Returned as {label, value} pairs (zero-valued fields
 * omitted) so both this file and customer-order-print.tsx's composition
 * section can render them as ordinary extra rows.
 */
export function useOwnCostLines(assembly: { laborCostPerUnit: string; packagingCostPerUnit: string; deliveryCostPerUnit: string; otherCostPerUnit: string } | undefined) {
  const t = useTranslations('bom');
  return useMemo(() => {
    if (!assembly) return [];
    const entries = [
      { key: 'labor', label: t('laborCostPerUnit'), value: Number(assembly.laborCostPerUnit) },
      { key: 'packaging', label: t('packagingCostPerUnit'), value: Number(assembly.packagingCostPerUnit) },
      { key: 'delivery', label: t('deliveryCostPerUnit'), value: Number(assembly.deliveryCostPerUnit) },
      { key: 'other', label: t('otherCostPerUnit'), value: Number(assembly.otherCostPerUnit) },
    ];
    return entries.filter((e) => e.value !== 0);
  }, [assembly, t]);
}

/**
 * One "X consists of: [table]" block per assembly node in the exploded
 * composition tree, followed by one such block per sub-assembly it uses —
 * in that order (parent's own component table first, then each child's own
 * block), so the printed document reads top-down: "виріб/підвиріб X
 * складається з товарів/підвиробу Y", then right below, "підвиріб Y
 * складається з товарів...", and so on down to raw products. `qty` is
 * already the fully accumulated quantity needed (order/batch qty × every
 * ancestor's qtyPerUnit down this branch), not a per-parent-unit ratio —
 * that's the actual question being answered ("скільки потрібно"). BOM
 * cycles are rejected at save time (setAssemblyComponents), so the
 * recursion always terminates at product leaves — no depth guard needed.
 *
 * Shared by every print view that needs to drill into sub-assembly
 * composition rather than stop at an opaque "sub-assembly, qty N" line:
 * customer-order-print.tsx (per order item), and this file's own
 * AssemblySpecPrint/production's PickListPrint (per direct sub-assembly
 * line, called at depth >= 1 so it always reads "Підвиріб", never "Виріб"
 * — the printed document's own top-level subject already has its own
 * header/table, this is only ever supplementary detail below it).
 */
export function AssemblyCompositionSection({ assemblyId, qty, depth, showPrice }: { assemblyId: string; qty: number; depth: number; showPrice: boolean }) {
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
  // the global per-client rate limit on a deep/wide real order (150+ leaf
  // products), permanently stranding whichever names got 429'd on their
  // raw id. See ComponentNameCell's own header comment.
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

/**
 * `qty` defaults to 1 (a pure per-unit BOM reference sheet — the only thing
 * that makes sense from bom/[id]/components/page.tsx, which has no order
 * context at all). Callers that DO have a quantity to build against (e.g.
 * production/[id]/page.tsx's `unitsPlanned`) pass it here so every line
 * prints "how much we need for this whole batch," not just the BOM ratio.
 *
 * When a component line is itself a sub-assembly, ticking "full
 * composition" in print options additionally explodes that sub-assembly's
 * own composition below the main table (AssemblyCompositionSection,
 * recursive) — otherwise it stays an opaque "sub-assembly, qty N" line,
 * same gap fixed for the pick-list print (pick-list-print.tsx) and already
 * solved on the sales side (customer-order-print.tsx).
 */
export function AssemblySpecPrint({ assemblyId, qty = 1 }: { assemblyId: string; qty?: number }) {
  const t = useTranslations('bom');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);
  const { data: cost } = useAssemblyCost(assemblyId);
  const ownCostLines = useOwnCostLines(assembly);

  const productIds = useMemo(() => (cost?.breakdown ?? []).filter((l) => l.componentType === 'PRODUCT' && l.productId).map((l) => l.productId as string), [cost]);
  const assemblyIds = useMemo(() => (cost?.breakdown ?? []).filter((l) => l.componentType === 'ASSEMBLY' && l.subAssemblyId).map((l) => l.subAssemblyId as string), [cost]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  const { data: photosOfThisAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  const { data: productsById } = useProductsByIds(productIds);
  const { data: assembliesById } = useAssembliesByIds(assemblyIds);

  const columns: PrintColumnOption[] = [
    { id: 'component', label: t('component') },
    { id: 'componentType', label: t('componentType') },
    { id: 'qtyPerUnit', label: t('qtyPerUnit') },
    { id: 'cost', label: t('cost') },
    { id: 'composition', label: t('fullComposition') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  if (!assembly || !cost) return null;

  // Only worth a second "needed for the whole batch" column when qty !== 1
  // — at qty === 1 (the plain BOM-reference case, e.g. bom/[id]/components)
  // it would just repeat the same numbers as qtyPerUnit.
  const showQtyNeededColumn = qty !== 1;
  const subAssemblyLines = cost.breakdown.filter(
    (l): l is CostBreakdownLine & { subAssemblyId: string } => l.componentType === 'ASSEMBLY' && Boolean(l.subAssemblyId),
  );

  function lineDownloadUrl(line: CostBreakdownLine): string | undefined {
    if (line.componentType === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printSpecification')}
        />
        <PreviewButton />
      </div>
      <PrintArea>
        <PrintDocumentHeader
          title={tp('specificationTitle')}
          subtitle={`${assembly.article ?? ''} ${assembly.name}`}
          photoUrl={photosOfThisAssembly?.[assemblyId]?.[0]?.downloadUrl}
        />
        <table>
          <thead>
            <tr>
              <th>#</th>
              {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
              {printOptions.isColumnVisible('component') && <th>{t('article')}</th>}
              {printOptions.isColumnVisible('component') && <th>{t('component')}</th>}
              {printOptions.isColumnVisible('componentType') && <th>{t('componentType')}</th>}
              {printOptions.isColumnVisible('qtyPerUnit') && <th>{t('qtyPerUnit')}</th>}
              {printOptions.isColumnVisible('qtyPerUnit') && showQtyNeededColumn && <th>{t('qtyNeeded')}</th>}
              {printOptions.isColumnVisible('cost') && <th>{t('cost')}</th>}
            </tr>
          </thead>
          <tbody>
            {cost.breakdown.map((line, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {printOptions.includePhotos && (
                  <td>
                    <Avatar src={lineDownloadUrl(line)} size="lg" />
                  </td>
                )}
                {printOptions.isColumnVisible('component') && (
                  <td className="font-bold">
                    <ComponentArticleCell
                      line={line}
                      productsById={productsById ?? EMPTY_PRODUCTS_MAP}
                      assembliesById={assembliesById ?? EMPTY_ASSEMBLIES_MAP}
                    />
                  </td>
                )}
                {printOptions.isColumnVisible('component') && (
                  <td>
                    <ComponentNameCell
                      line={line}
                      productsById={productsById ?? EMPTY_PRODUCTS_MAP}
                      assembliesById={assembliesById ?? EMPTY_ASSEMBLIES_MAP}
                    />
                  </td>
                )}
                {printOptions.isColumnVisible('componentType') && <td>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</td>}
                {printOptions.isColumnVisible('qtyPerUnit') && <td>{line.qtyPerUnit}</td>}
                {printOptions.isColumnVisible('qtyPerUnit') && showQtyNeededColumn && <td>{line.qtyPerUnit * qty}</td>}
                {printOptions.isColumnVisible('cost') && <td>{formatEur(line.lineCost * qty)}</td>}
              </tr>
            ))}
            {printOptions.isColumnVisible('cost') &&
              ownCostLines.map((line, i) => (
                <tr key={`own-${line.key}`}>
                  <td>{cost.breakdown.length + i + 1}</td>
                  {printOptions.includePhotos && <td />}
                  {printOptions.isColumnVisible('component') && <td />}
                  {printOptions.isColumnVisible('component') && <td>{line.label}</td>}
                  {printOptions.isColumnVisible('componentType') && <td>{t('componentTypeOwn')}</td>}
                  {printOptions.isColumnVisible('qtyPerUnit') && <td>—</td>}
                  {printOptions.isColumnVisible('qtyPerUnit') && showQtyNeededColumn && <td>{qty}</td>}
                  <td>{formatEur(line.value * qty)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {printOptions.isColumnVisible('cost') && (
          <p className="mt-4 text-sm font-semibold">
            {qty === 1 ? (
              <>
                {t('cost')}: {formatEur(cost.costPerUnit)} / {tp('units').toLowerCase()}
              </>
            ) : (
              <>
                {t('cost')}: {formatEur(cost.costPerUnit * qty)} ({formatEur(cost.costPerUnit)} / {tp('units').toLowerCase()} × {qty})
              </>
            )}
          </p>
        )}
        {printOptions.isColumnVisible('composition') && subAssemblyLines.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-base font-semibold">{tp('compositionSectionTitle')}</h2>
            {subAssemblyLines.map((l, i) => (
              <AssemblyCompositionSection
                key={i}
                assemblyId={l.subAssemblyId}
                qty={l.qtyPerUnit * qty}
                depth={1}
                showPrice={printOptions.isColumnVisible('cost')}
              />
            ))}
          </div>
        )}
      </PrintArea>
    </>
  );
}
