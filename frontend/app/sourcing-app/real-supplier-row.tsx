'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEur } from '@/lib/utils';
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
export function RealSupplierRow({ productId, supplier, canPropose }: { productId: string; supplier: RealSupplierPrice; canPropose: boolean }) {
  const [proposing, setProposing] = useState(false);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const createProposal = useCreatePriceProposal();

  async function submit() {
    const proposedPriceEur = Number(price);
    if (!Number.isFinite(proposedPriceEur) || proposedPriceEur <= 0) return;
    await createProposal.mutateAsync({ productId, supplierId: supplier.id, proposedPriceEur, note: note.trim() || undefined });
    setProposing(false);
    setPrice('');
    setNote('');
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
