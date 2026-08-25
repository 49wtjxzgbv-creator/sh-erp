'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { AssemblyCompositionSection } from '@/components/domain/bom/assembly-spec-print';
import { Avatar } from '@/components/ui/avatar';
import type { ProductionOrderPickListItem } from '@/lib/api-client/production';
import type { DecimalString } from '@/lib/api-client/decimal';

export interface PickListPrintProps {
  orderId: string;
  assemblyId: string;
  unitsPlanned: DecimalString;
  pickListItems: ProductionOrderPickListItem[];
}

/**
 * Prints `order.pickListItems` — the materials-consumption breakdown
 * (description/qty/unitPriceEur/lineTotalEur) already rendered on the
 * production order detail page, in a dedicated print layout. This is a
 * deliberate scope decision, not an oversight: the legacy warehouse
 * pick/issue sheet ("Аркуш видачі зі складу") had a richer per-line shape —
 * article, internal code, bin/cell location — none of which exist on this
 * backend's `ProductionOrderPickListItem`. Reproducing the legacy sheet
 * exactly would need new backend fields/endpoints, out of scope for this
 * pass; this prints exactly what the order detail page already shows on
 * screen, adding no new data exposure, with the assembly's real name
 * resolved (rather than the raw id shown on screen) since a printed
 * document handed to a customer or shop floor worker showing a UUID would
 * be a real regression.
 *
 * Photos (added 2026-08-25, real gap found via user report): each line
 * already carries productId (raw material) or subAssemblyId (a consumed
 * sub-assembly) — same batched useFilesForEntities pattern as
 * assembly-spec-print.tsx, one request per entity type instead of per row.
 * Rows from before subAssemblyId existed (both ids null) just show no photo,
 * same as a line whose product/assembly never had one uploaded.
 *
 * Full composition (added 2026-08-25, same user report): ticking "full
 * composition" additionally explodes each consumed sub-assembly line's own
 * composition below the main table (AssemblyCompositionSection, recursive)
 * — otherwise a sub-assembly line stays an opaque "[assembly] Name, qty N",
 * same gap already fixed for assembly-spec-print.tsx and customer-order-print.tsx.
 */
export function PickListPrint({ orderId, assemblyId, unitsPlanned, pickListItems }: PickListPrintProps) {
  const t = useTranslations('production');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);

  const productIds = useMemo(() => pickListItems.filter((l) => l.productId).map((l) => l.productId as string), [pickListItems]);
  const subAssemblyIds = useMemo(() => pickListItems.filter((l) => l.subAssemblyId).map((l) => l.subAssemblyId as string), [pickListItems]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', subAssemblyIds, 'ASSEMBLY_PHOTO');

  function lineDownloadUrl(line: ProductionOrderPickListItem): string | undefined {
    if (line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'qty', label: t('qty') },
    { id: 'unitPrice', label: t('unitPrice') },
    { id: 'lineTotal', label: t('lineTotal') },
    { id: 'composition', label: t('fullComposition') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  const subAssemblyLines = pickListItems.filter((l): l is ProductionOrderPickListItem & { subAssemblyId: string } => Boolean(l.subAssemblyId));

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printPickList')}
        />
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader
          title={tp('pickListTitle')}
          subtitle={`${assembly?.name ?? assemblyId} — ${unitsPlanned} ${tp('units')} — ${tp('orderId')} ${orderId.slice(0, 8)}`}
        />
        <table>
          <thead>
            <tr>
              {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
              {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
              {printOptions.isColumnVisible('qty') && <th>{t('qty')}</th>}
              {printOptions.isColumnVisible('unitPrice') && <th>{t('unitPrice')}</th>}
              {printOptions.isColumnVisible('lineTotal') && <th>{t('lineTotal')}</th>}
            </tr>
          </thead>
          <tbody>
            {pickListItems.map((line) => (
              <tr key={line.id}>
                {printOptions.includePhotos && (
                  <td>
                    <Avatar src={lineDownloadUrl(line)} size="lg" />
                  </td>
                )}
                {printOptions.isColumnVisible('description') && <td>{line.description}</td>}
                {printOptions.isColumnVisible('qty') && <td>{line.qty}</td>}
                {printOptions.isColumnVisible('unitPrice') && <td>{line.unitPriceEur != null ? formatEur(Number(line.unitPriceEur)) : '—'}</td>}
                {printOptions.isColumnVisible('lineTotal') && <td>{line.lineTotalEur != null ? formatEur(Number(line.lineTotalEur)) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-8 text-xs">{tp('issuedBy')}: ____________________&nbsp;&nbsp;&nbsp;&nbsp;{tp('receivedBy')}: ____________________</p>
        {printOptions.isColumnVisible('composition') && subAssemblyLines.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-base font-semibold">{tp('compositionSectionTitle')}</h2>
            {subAssemblyLines.map((line) => (
              <AssemblyCompositionSection
                key={line.id}
                assemblyId={line.subAssemblyId}
                qty={Number(line.qty)}
                depth={1}
                showPrice={printOptions.isColumnVisible('unitPrice')}
              />
            ))}
          </div>
        )}
      </PrintArea>
    </>
  );
}
