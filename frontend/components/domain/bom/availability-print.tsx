'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { Avatar } from '@/components/ui/avatar';
import type { AvailabilityResult } from '@/lib/api-client/bom';

function ShortageNameCell({ productId }: { productId: string }) {
  const { data: product } = useProduct(productId);
  return <>{product ? `${product.name}${product.article ? ` (${product.article})` : ''}` : productId}</>;
}

export function AvailabilityPrint({ assemblyId, result }: { assemblyId: string; result: AvailabilityResult }) {
  const t = useTranslations('bom');
  const tp = useTranslations('print');
  const { data: assembly } = useAssembly(assemblyId);

  const productIds = useMemo(() => result.shortages.map((s) => s.productId), [result]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  const columns: PrintColumnOption[] = [
    { id: 'component', label: t('component') },
    { id: 'needed', label: t('needed') },
    { id: 'available', label: t('available') },
    { id: 'shortage', label: t('shortage') },
  ];
  const printOptions = usePrintOptions({ columns, hasPhotos: true });

  if (!assembly) return null;

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printAvailability')}
        />
        <PreviewButton />
      </div>
      <PrintArea>
        <PrintDocumentHeader
          title={tp('availabilityTitle')}
          subtitle={`${assembly.article ?? ''} ${assembly.name} — ${t('qty')}: ${result.qty}`}
        />
        <p className="mb-3 text-sm font-semibold">
          {result.sufficient ? t('sufficient') : t('insufficientStock')}
        </p>
        {result.shortages.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
                {printOptions.isColumnVisible('component') && <th>{t('component')}</th>}
                {printOptions.isColumnVisible('needed') && <th>{t('needed')}</th>}
                {printOptions.isColumnVisible('available') && <th>{t('available')}</th>}
                {printOptions.isColumnVisible('shortage') && <th>{t('shortage')}</th>}
              </tr>
            </thead>
            <tbody>
              {result.shortages.map((s, i) => (
                <tr key={s.productId}>
                  <td>{i + 1}</td>
                  {printOptions.includePhotos && (
                    <td>
                      <Avatar src={photosByProduct?.[s.productId]?.[0]?.downloadUrl} size="lg" zoomable={false} />
                    </td>
                  )}
                  {printOptions.isColumnVisible('component') && (
                    <td>
                      <ShortageNameCell productId={s.productId} />
                    </td>
                  )}
                  {printOptions.isColumnVisible('needed') && <td>{s.needed}</td>}
                  {printOptions.isColumnVisible('available') && <td>{s.available}</td>}
                  {printOptions.isColumnVisible('shortage') && <td>{s.shortage}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PrintArea>
    </>
  );
}
