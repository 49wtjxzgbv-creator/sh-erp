'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEur } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';
import { useCreatePriceProposal } from './use-sourcing-app';
import type { RealSupplierPrice } from './sourcing-app-client';

/**
 * "правка ціни щоб було тільки через підтвердження в основній erp"
 * (2026-11-10) — the ✏️ button only ever submits a PROPOSAL; the real
 * `ProductSupplier.price` never changes until someone confirms it in the
 * main ERP (`PriceProposalsService#approve`). `productId` is this
 * product's own id, needed since the proposal is keyed on
 * (productId, supplierId), not just the supplier.
 */
/** `((benchmark - ourPrice) / benchmark) * 100` — positive = potential margin if sold at the benchmark price, negative = we're already paying the supplier MORE than that benchmark. Null when either side is missing/non-positive. */
function marginVsBenchmark(ourPrice: number | null, benchmark: number | null | undefined): number | null {
  if (ourPrice === null || benchmark === null || benchmark === undefined || benchmark <= 0) return null;
  return ((benchmark - ourPrice) / benchmark) * 100;
}

function GermanMarginLine({ label, percent }: { label: string; percent: number | null }) {
  if (percent === null) return null;
  const rounded = Math.round(percent);
  return (
    <p className="text-xs" style={{ color: rounded >= 0 ? 'var(--tg-hint)' : '#dc2626' }}>
      🇩🇪 {label}: {rounded >= 0 ? `маржа ${rounded}%` : `дорожче на ${Math.abs(rounded)}%`}
    </p>
  );
}

export function RealSupplierRow({
  productId,
  supplier,
  canPropose,
  cheapestOurPrice,
  germanPriceExclVat,
  germanPriceInclVat,
}: {
  productId: string;
  supplier: RealSupplierPrice;
  canPropose: boolean;
  /** Lowest `ourPrice` among ALL real suppliers of this product — only passed when there are 2+ to compare, so one lone supplier never gets a meaningless "найдешевша" badge. "потрібен... аналізатор по цінах... відсоткове співвідношення" (2026-11-25). */
  cheapestOurPrice?: number | null;
  /** "має бути порівняння цін німецька з пдв без пдв ціна постачальника... кожен постачальник окремо" (2026-11-25) — Product.germanPriceExclVat/InclVat, this product's OWN German-market benchmark, compared against THIS supplier's own ourPrice (not an aggregate across suppliers). */
  germanPriceExclVat?: number | null;
  germanPriceInclVat?: number | null;
}) {
  const [proposing, setProposing] = useState(false);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const createProposal = useCreatePriceProposal();

  async function submit() {
    const proposedPriceEur = Number(price);
    if (!Number.isFinite(proposedPriceEur) || proposedPriceEur <= 0) return;
    try {
      await createProposal.mutateAsync({ productId, supplierId: supplier.id, proposedPriceEur, note: note.trim() || undefined });
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
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">🏭 {supplier.name}</p>
        {canPropose && !proposing && !supplier.pendingProposal && (
          <button type="button" onClick={() => setProposing(true)} className="shrink-0 text-xs" style={{ color: 'var(--tg-link)' }}>
            ✏️ Запропонувати ціну
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
        {supplier.ourPrice !== null && `наша: ${formatEur(supplier.ourPrice)}`}
        {supplier.ourPrice !== null && supplier.supplierOfferedPrice !== null && ' · '}
        {supplier.supplierOfferedPrice !== null && `постачальник: ${formatEur(supplier.supplierOfferedPrice)}`}
      </p>
      {supplier.ourPrice !== null && cheapestOurPrice !== null && cheapestOurPrice !== undefined && (
        supplier.ourPrice <= cheapestOurPrice ? (
          <p className="mt-0.5 text-xs font-medium" style={{ color: 'var(--tg-link)' }}>💚 найдешевша</p>
        ) : (
          <p className="mt-0.5 text-xs font-medium" style={{ color: '#d97706' }}>
            +{Math.round(((supplier.ourPrice - cheapestOurPrice) / cheapestOurPrice) * 100)}% від найдешевшої
          </p>
        )
      )}

      <GermanMarginLine label="без ПДВ" percent={marginVsBenchmark(supplier.ourPrice, germanPriceExclVat)} />
      <GermanMarginLine label="з ПДВ" percent={marginVsBenchmark(supplier.ourPrice, germanPriceInclVat)} />

      {supplier.pendingProposal && (
        <p className="mt-1 text-xs" style={{ color: 'var(--tg-link)' }}>
          ⏳ Запропоновано {formatEur(supplier.pendingProposal.proposedPriceEur)} — очікує підтвердження в ERP
          {supplier.pendingProposal.note && ` (${supplier.pendingProposal.note})`}
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
