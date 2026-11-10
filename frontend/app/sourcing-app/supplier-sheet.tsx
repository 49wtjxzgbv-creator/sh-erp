'use client';

import { useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { ContactLinks } from './contact-links';
import { NoteEditor } from './note-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEur } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';
import { useCreatePriceProposal } from './use-sourcing-app';
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
  canPropose,
}: {
  supplier: RealSupplier | null;
  onClose: () => void;
  onOpenProduct: (productId: string) => void;
  canPropose: boolean;
}) {
  return (
    <MobileSheet open={Boolean(supplier)} onOpenChange={(open) => !open && onClose()} title={supplier ? supplier.name : 'Постачальник'}>
      {supplier && (
        <div className="space-y-3 pb-4">
          <ContactLinks phone={supplier.phone} email={supplier.email} website={null} />

          <NoteEditor entityType="Supplier" entityId={supplier.id} note={supplier.note} />

          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>
            {supplier.products.length} товар{supplier.products.length === 1 ? '' : supplier.products.length < 5 ? 'и' : 'ів'}
          </p>

          <div className="space-y-1.5">
            {supplier.products.map((p) => (
              <SupplierProductRow key={p.id} supplierId={supplier.id} product={p} canPropose={canPropose} onOpenProduct={onOpenProduct} />
            ))}
          </div>
        </div>
      )}
    </MobileSheet>
  );
}

/**
 * "правка ціни щоб було тільки через підтвердження в основній erp"
 * (2026-11-10) — `ProductSheet`'s own `RealSupplierRow` already let an
 * admin propose a price from the product's side; this is the same
 * capability from the SUPPLIER's side (2026-11-11 — browsing a supplier's
 * product list used to be a dead end for that, forcing an extra hop
 * through the product's own card just to propose a price). A plain
 * `<button>` can't nest the price-propose form's own inputs/buttons, so
 * the navigate-to-product affordance and the propose-price affordance are
 * two separate controls sharing one row, not one button wrapping both.
 */
function SupplierProductRow({
  supplierId,
  product,
  canPropose,
  onOpenProduct,
}: {
  supplierId: string;
  product: RealSupplier['products'][number];
  canPropose: boolean;
  onOpenProduct: (productId: string) => void;
}) {
  const [proposing, setProposing] = useState(false);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const createProposal = useCreatePriceProposal();

  async function submit() {
    const proposedPriceEur = Number(price);
    if (!Number.isFinite(proposedPriceEur) || proposedPriceEur <= 0) return;
    try {
      await createProposal.mutateAsync({ productId: product.id, supplierId, proposedPriceEur, note: note.trim() || undefined });
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
      setProposing(false);
      setPrice('');
      setNote('');
    } catch {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      getTelegramWebApp()?.showAlert('Не вдалося надіслати пропозицію ціни. Спробуйте ще раз.');
    }
  }

  return (
    <div className="rounded-lg p-2.5 text-sm" style={{ background: 'var(--tg-secondary-bg)' }}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onOpenProduct(product.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left active:opacity-70"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ background: 'var(--tg-bg)' }}>
            {product.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL thumbnail
              <img src={product.photoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              '📦'
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span style={{ color: 'var(--tg-hint)' }}>{product.article}</span> — {product.name}
          </span>
          {product.ourPrice !== null && <span className="shrink-0 font-medium">{formatEur(product.ourPrice)}</span>}
        </button>
        {canPropose && !proposing && !product.pendingProposal && (
          <button type="button" onClick={() => setProposing(true)} className="shrink-0 px-1 text-xs" style={{ color: 'var(--tg-link)' }}>
            ✏️
          </button>
        )}
      </div>

      {product.pendingProposal && (
        <p className="mt-1 text-xs" style={{ color: 'var(--tg-link)' }}>
          ⏳ Запропоновано {formatEur(product.pendingProposal.proposedPriceEur)} — очікує підтвердження в ERP
          {product.pendingProposal.note && ` (${product.pendingProposal.note})`}
        </p>
      )}

      {proposing && (
        <div className="mt-2 space-y-1.5">
          <Input
            autoFocus
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Нова ціна, €"
          />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Нотатка (необов'язково)" />
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} loading={createProposal.isPending}>Надіслати</Button>
            <Button size="sm" variant="outline" onClick={() => setProposing(false)}>Скасувати</Button>
          </div>
        </div>
      )}
    </div>
  );
}
