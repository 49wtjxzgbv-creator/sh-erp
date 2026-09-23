'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FileText } from 'lucide-react';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { FileAssetWithUrl } from '@/lib/api-client/files';
import { generateSupplierRequestDocumentsPdf } from '@/lib/api-client/sales';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { AssemblyCompositionSection } from '@/components/domain/bom/assembly-spec-print';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

export interface SupplierRequestLineForPrint {
  kind?: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  /** Own article/SKU, printed as its own column right after the photo (2026-09-23 user request) — null/undefined when genuinely unset. */
  article?: string | null;
  qty: number;
  /** The resolved supplier's price, null/undefined when unknown — printed only when the "Ціна" column is selected. */
  price?: number | null;
}

export interface SupplierRequestGroupForPrint {
  supplierId?: string;
  supplierName: string;
  lines: SupplierRequestLineForPrint[];
}

export interface SupplierRequestsPrintProps {
  groups: SupplierRequestGroupForPrint[];
  /**
   * Overrides the default `<PreviewButton />` (same-URL `?print=1` reopen).
   * The caller (shortage/page.tsx) needs this because `groups` here is
   * already filtered to a specific supplier and carries the user's
   * live-typed quantities — a same-URL reload in a fresh tab would refetch
   * the raw, unfiltered, unedited shortage preview instead, so the page
   * serializes both the supplier filter and the current quantities into the
   * preview URL itself (same reasoning as product-labels-dialog's own
   * custom `openPreview`).
   */
  onPreview?: () => void;
}

/**
 * Prints the supplier-grouped shortage preview as a set of purchase-request
 * documents ("Заявки постачальникам" in legacy) — one table per supplier,
 * a page break between suppliers, matching the legacy layout. Uses the
 * page's own live `groups` state (the qty the user has actually typed in,
 * not the raw preview) so what prints matches what "Create purchase orders"
 * would actually submit.
 *
 * "Повний склад" (2026-09-22 user request — a supplier line can be a whole
 * виріб/підвиріб bought as one unit (`kind: 'ASSEMBLY'`, "bought whole" per
 * CustomerOrderShortageService's own walkAssembly comment), not just a raw
 * product): ticking "full composition" in print options additionally
 * explodes each ASSEMBLY line's own BOM breakdown below that supplier's
 * table (AssemblyCompositionSection, recursive — same shared component
 * AssemblySpecPrint/PickListPrint/customer-order-print.tsx already use),
 * so what prints isn't just an opaque "виріб X, qty N" line. Off by default
 * — this is internal detail, not necessarily meant for the supplier's own
 * copy of the request.
 *
 * 2026-09-23 user request: an "Артикул" column, always shown right after
 * the photo (not toggleable — unlike the other columns, this isn't
 * optional detail). Comes straight off `ShortageLine.article`
 * (customer-order-shortage.service.ts) — previously only ever folded into
 * `description`'s own "ARTICLE — Name" prefix for a PRODUCT line, and
 * never available at all for an ASSEMBLY line. The `#` row-numbering
 * column is pinned to `.print-index-col` (3ch, globals.css) — `table-
 * layout: fixed` would otherwise give it an equal share of the table
 * width as every text column next to it, same reasoning `.print-photo-col`
 * already documents.
 *
 * "Вкладені документи" (2026-09-23 user request, revised same day): ticking
 * "include attached documents" reveals a "download documents PDF" button.
 * The first version instead embedded each attachment inline into this DOM
 * (`<iframe>`/`<img>`) and relied on `window.print()` — the user reported
 * this "looks bad" because Chromium's print pipeline rasterizes an embedded
 * PDF into a blurry bitmap instead of inserting the real file. The button
 * now POSTs the printable lines' attached-document ids + headings (article
 * + name) to a backend endpoint (SupplierRequestDocumentsPdfService) that
 * merges the real PDF pages (or draws an image attachment onto its own
 * heading page) into one genuine downloadable PDF — never rasterized. CAD
 * sources (STEP/DXF) have no printable page rendering and are skipped, same
 * as before.
 */
export function SupplierRequestsPrint({ groups, onPreview }: SupplierRequestsPrintProps) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');
  const printable = groups.filter((g) => g.lines.some((l) => l.qty > 0));

  const productIds = useMemo(
    () => Array.from(new Set(printable.flatMap((g) => g.lines).filter((l) => l.kind === 'PRODUCT' && l.productId).map((l) => l.productId as string))),
    [printable],
  );
  const assemblyIds = useMemo(
    () =>
      Array.from(
        new Set(printable.flatMap((g) => g.lines).filter((l) => l.kind === 'ASSEMBLY' && l.subAssemblyId).map((l) => l.subAssemblyId as string)),
      ),
    [printable],
  );
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  const { data: documentsByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_DOCUMENT');
  const { data: documentsByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_DOCUMENT');

  function lineDownloadUrl(line: SupplierRequestLineForPrint): string | undefined {
    if (line.kind === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  /**
   * "Вкладені документи" (2026-09-23 user request): every PRODUCT_DOCUMENT/
   * ASSEMBLY_DOCUMENT file attached to a line's own product/assembly, each
   * printed on its own full page (.print-document-page, globals.css) with
   * the line's article + name as a page header. Only PDF and image
   * attachments can actually be flattened onto a printed page this way —
   * CAD sources (STEP/DXF) have no printable page rendering here, so those
   * are silently skipped rather than left as dead space.
   */
  function lineDocuments(line: SupplierRequestLineForPrint): FileAssetWithUrl[] {
    if (line.kind === 'PRODUCT' && line.productId) return documentsByProduct?.[line.productId] ?? [];
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return documentsByAssembly?.[line.subAssemblyId] ?? [];
    return [];
  }

  function isPrintableDocument(doc: FileAssetWithUrl): boolean {
    return doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('image/');
  }

  /**
   * `description` still carries "ARTICLE — Name" as one string at the
   * source (customer-order-shortage.service.ts — kept as-is there since
   * the on-screen shortage table still shows it combined, with no article
   * column of its own). Now that print has its own dedicated article
   * column, showing that same prefix again in the description cell would
   * just repeat it — strip it here, print-display only.
   */
  function descriptionWithoutArticle(line: SupplierRequestLineForPrint): string {
    if (line.article && line.description.startsWith(`${line.article} — `)) {
      return line.description.slice(line.article.length + 3);
    }
    return line.description;
  }

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'qtyToOrder', label: t('qtyToOrder') },
    { id: 'unitPrice', label: t('unitPrice') },
    { id: 'price', label: t('expectedPrice') },
    { id: 'composition', label: t('fullComposition') },
    { id: 'documents', label: t('includeAttachedDocuments') },
  ];

  function groupTotal(group: SupplierRequestGroupForPrint): number {
    return group.lines
      .filter((l) => l.qty > 0 && l.price != null)
      .reduce((sum, l) => sum + (l.price as number) * l.qty, 0);
  }
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  const documentItems = useMemo(
    () =>
      printable.flatMap((group) =>
        group.lines
          .filter((l) => l.qty > 0)
          .flatMap((line) =>
            lineDocuments(line)
              .filter(isPrintableDocument)
              .map((doc) => ({
                fileAssetId: doc.id,
                heading: `${line.article ? `${line.article} — ` : ''}${descriptionWithoutArticle(line)}`,
              })),
          ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineDocuments/descriptionWithoutArticle close over documentsByProduct/documentsByAssembly/printable, which are already the real deps below.
    [printable, documentsByProduct, documentsByAssembly],
  );

  const downloadDocumentsMutation = useMutation({
    mutationFn: () => generateSupplierRequestDocumentsPdf(documentItems),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printPurchaseRequest')}
        />
        {onPreview ? (
          <Button type="button" variant="outline" size="sm" onClick={onPreview}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {tp('previewAction')}
          </Button>
        ) : (
          <PreviewButton />
        )}
        {printOptions.isColumnVisible('documents') && documentItems.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloadDocumentsMutation.isPending}
            onClick={() => downloadDocumentsMutation.mutate()}
          >
            <FileText className="mr-2 h-4 w-4" />
            {t('downloadAttachedDocumentsPdf')}
          </Button>
        )}
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('supplierRequestsTitle')} />
        {printable.map((group, gi) => (
          <div key={group.supplierId ?? `none-${gi}`} className={gi < printable.length - 1 ? 'print-page-break' : ''}>
            <h2 className="mb-2 font-semibold">{tp('requestTo')}: {group.supplierName}</h2>
            <table className="mb-6">
              <thead>
                <tr>
                  <th className="print-index-col">#</th>
                  {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
                  <th>{t('article')}</th>
                  {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
                  {printOptions.isColumnVisible('qtyToOrder') && <th>{t('qtyToOrder')}</th>}
                  {printOptions.isColumnVisible('unitPrice') && <th>{t('unitPrice')}</th>}
                  {printOptions.isColumnVisible('price') && <th>{t('expectedPrice')}</th>}
                </tr>
              </thead>
              <tbody>
                {group.lines
                  .filter((l) => l.qty > 0)
                  .map((line, li) => (
                    <tr key={li}>
                      <td className="print-index-col">{li + 1}</td>
                      {printOptions.includePhotos && (
                        <td>
                          <Avatar src={lineDownloadUrl(line)} size="lg" />
                        </td>
                      )}
                      <td className="font-bold">{line.article ?? ''}</td>
                      {printOptions.isColumnVisible('description') && <td>{descriptionWithoutArticle(line)}</td>}
                      {printOptions.isColumnVisible('qtyToOrder') && <td>{line.qty}</td>}
                      {printOptions.isColumnVisible('unitPrice') && <td>{line.price != null ? formatEur(line.price) : '—'}</td>}
                      {printOptions.isColumnVisible('price') && (
                        <td>{line.price != null ? formatEur(line.price * line.qty) : '—'}</td>
                      )}
                    </tr>
                  ))}
              </tbody>
              {printOptions.isColumnVisible('price') && (
                <tfoot>
                  <tr>
                    <td
                      colSpan={
                        1 + // #
                        1 + // article — always shown, see the header <th> above
                        (printOptions.includePhotos ? 1 : 0) +
                        (printOptions.isColumnVisible('description') ? 1 : 0) +
                        (printOptions.isColumnVisible('qtyToOrder') ? 1 : 0) +
                        (printOptions.isColumnVisible('unitPrice') ? 1 : 0)
                      }
                      style={{ textAlign: 'right', fontWeight: 600 }}
                    >
                      {tp('supplierRequestTotal')}
                    </td>
                    <td style={{ fontWeight: 600 }}>{formatEur(groupTotal(group))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {printOptions.isColumnVisible('composition') && (
              <>
                {group.lines
                  .filter((l): l is SupplierRequestLineForPrint & { subAssemblyId: string } => l.kind === 'ASSEMBLY' && l.qty > 0 && Boolean(l.subAssemblyId))
                  .map((line, li) => (
                    <div key={li} className="mt-4">
                      <h3 className="mb-1 text-sm font-semibold">{line.description} — {t('fullComposition')}</h3>
                      <AssemblyCompositionSection
                        assemblyId={line.subAssemblyId}
                        qty={line.qty}
                        depth={1}
                        showPrice={printOptions.isColumnVisible('unitPrice')}
                      />
                    </div>
                  ))}
              </>
            )}
          </div>
        ))}
      </PrintArea>
    </>
  );
}
