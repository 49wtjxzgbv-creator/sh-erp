import { useTranslations } from 'next-intl';
import { PrintDocumentHeader } from '@/components/domain/print/print-area';
import type { SelectedLabel } from './product-labels-dialog';

export { expandLabelCopies } from './product-labels-dialog';

/**
 * The actual printable markup, extracted out of ProductLabelsDialog so the
 * new-tab preview (catalog/page.tsx's `?print=1&labels=...` branch) can
 * render the exact same labels without re-opening the dialog — that state
 * (which products, how many copies) lives in the URL for the preview
 * instead of the dialog's local React state.
 */
export function ProductLabelsPrintContent({ labelInstances }: { labelInstances: SelectedLabel[] }) {
  const t = useTranslations('catalog');
  const tp = useTranslations('print');
  return (
    <>
      <PrintDocumentHeader title={tp('labelsTitle')} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 8,
        }}
      >
        {labelInstances.map((label, i) => (
          <div key={i} style={{ border: '1px dashed #999', borderRadius: 4, padding: 8 }}>
            {label.code && <div style={{ fontSize: 10 }}>{label.code}</div>}
            <div style={{ fontSize: '1.5em', fontWeight: 700 }}>{label.article}</div>
            <div style={{ fontSize: '0.85em' }}>{label.name}</div>
            {label.cell && (
              <div style={{ fontSize: 10 }}>
                {t('cell')}: {label.cell}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
