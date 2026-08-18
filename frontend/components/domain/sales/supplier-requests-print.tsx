'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

export interface SupplierRequestLineForPrint {
  kind?: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  qty: number;
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

  function lineDownloadUrl(line: SupplierRequestLineForPrint): string | undefined {
    if (line.kind === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'qtyToOrder', label: t('qtyToOrder') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

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
      </div>
      <PrintArea>
        <PrintDocumentHeader title={tp('supplierRequestsTitle')} />
        {printable.map((group, gi) => (
          <div key={group.supplierId ?? `none-${gi}`} className={gi < printable.length - 1 ? 'print-page-break' : ''}>
            <h2 className="mb-2 font-semibold">{tp('requestTo')}: {group.supplierName}</h2>
            <table className="mb-6">
              <thead>
                <tr>
                  <th>#</th>
                  {printOptions.includePhotos && <th>{tp('photoColumn')}</th>}
                  {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
                  {printOptions.isColumnVisible('qtyToOrder') && <th>{t('qtyToOrder')}</th>}
                </tr>
              </thead>
              <tbody>
                {group.lines
                  .filter((l) => l.qty > 0)
                  .map((line, li) => (
                    <tr key={li}>
                      <td>{li + 1}</td>
                      {printOptions.includePhotos && (
                        <td>
                          <Avatar src={lineDownloadUrl(line)} size="lg" />
                        </td>
                      )}
                      {printOptions.isColumnVisible('description') && <td>{line.description}</td>}
                      {printOptions.isColumnVisible('qtyToOrder') && <td>{line.qty}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </PrintArea>
    </>
  );
}
