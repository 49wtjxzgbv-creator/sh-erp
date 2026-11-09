'use client';

import { useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { PriceChips } from './price-chips';
import { StatusPill } from './status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { formatEur } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';
import { useProductDetail } from './use-sourcing-app';

export function ProductSheet({
  productId,
  onClose,
  onOpenCandidate,
}: {
  productId: string | null;
  onClose: () => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const { data: product, isLoading } = useProductDetail(productId);
  const [copied, setCopied] = useState(false);

  async function copyRfq() {
    if (!product?.category) return;
    await navigator.clipboard.writeText(product.category.rfqTemplate);
    setCopied(true);
    getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <MobileSheet open={Boolean(productId)} onOpenChange={(open) => !open && onClose()} title={product ? `${product.article}` : 'Товар'}>
      {isLoading || !product ? (
        <div className="space-y-3 py-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ) : (
        <div className="space-y-4 pb-4">
          <div className="flex h-44 items-center justify-center overflow-hidden rounded-xl" style={{ background: 'var(--tg-secondary-bg)' }}>
            {product.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
              <img src={product.photoUrl} alt={product.name} className="h-full w-full object-contain" />
            ) : (
              <span className="text-5xl">📦</span>
            )}
          </div>

          <div>
            <p className="text-base font-semibold">{product.name}</p>
            <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>{product.article}</p>
          </div>

          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Наші ціни</p>
            <PriceChips prices={product.prices} />
          </section>

          {product.realSuppliers.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Наявні постачальники</p>
              <div className="space-y-2">
                {product.realSuppliers.map((s) => (
                  <div key={s.id} className="rounded-lg p-2.5 text-sm" style={{ background: 'var(--tg-secondary-bg)' }}>
                    <p className="font-medium">🏭 {s.name}</p>
                    <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
                      {s.ourPrice !== null && `наша: ${formatEur(s.ourPrice)}`}
                      {s.ourPrice !== null && s.supplierOfferedPrice !== null && ' · '}
                      {s.supplierOfferedPrice !== null && `постачальник: ${formatEur(s.supplierOfferedPrice)}`}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {product.candidateSuppliers.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Можливі постачальники</p>
              <div className="space-y-2">
                {product.candidateSuppliers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenCandidate(c.id)}
                    className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-sm active:opacity-70"
                    style={{ background: 'var(--tg-secondary-bg)' }}
                  >
                    <span className="font-medium">🆕 {c.name}</span>
                    <StatusPill status={c.status} label={c.statusLabel} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {product.category && (
            <Button className="w-full" variant="outline" onClick={copyRfq}>
              {copied ? '✅ Скопійовано' : '📋 Скопіювати текст запиту'}
            </Button>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
