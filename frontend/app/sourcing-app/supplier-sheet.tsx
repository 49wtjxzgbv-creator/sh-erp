'use client';

import { MobileSheet } from './mobile-sheet';
import { ContactLinks } from './contact-links';
import { formatEur } from '@/lib/utils';
import type { RealSupplier } from './sourcing-app-client';

/**
 * "у вкладці постачальники наші потрібно щоб коли ми натискаємо на якогось
 * то відкривався список товарів які вони постачають" (2026-11-10) —
 * `SupplierCard` on the list only ever showed the first 5 products as a
 * preview; this is the full, untruncated list, each row opening the real
 * `ProductSheet` (via `onOpenProduct`) for full detail/photos/documents.
 */
export function SupplierSheet({
  supplier,
  onClose,
  onOpenProduct,
}: {
  supplier: RealSupplier | null;
  onClose: () => void;
  onOpenProduct: (productId: string) => void;
}) {
  return (
    <MobileSheet open={Boolean(supplier)} onOpenChange={(open) => !open && onClose()} title={supplier ? supplier.name : 'Постачальник'}>
      {supplier && (
        <div className="space-y-3 pb-4">
          <ContactLinks phone={supplier.phone} email={supplier.email} website={null} />

          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>
            {supplier.products.length} товар{supplier.products.length === 1 ? '' : supplier.products.length < 5 ? 'и' : 'ів'}
          </p>

          <div className="space-y-1.5">
            {supplier.products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProduct(p.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2.5 text-left text-sm active:opacity-70"
                style={{ background: 'var(--tg-secondary-bg)' }}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span style={{ color: 'var(--tg-hint)' }}>{p.article}</span> — {p.name}
                </span>
                {p.ourPrice !== null && <span className="shrink-0 font-medium">{formatEur(p.ourPrice)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </MobileSheet>
  );
}
