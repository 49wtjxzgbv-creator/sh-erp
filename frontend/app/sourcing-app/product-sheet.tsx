'use client';

import { useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { PriceChips } from './price-chips';
import { StatusPill } from './status-pill';
import { Model3DViewer } from './model-3d-viewer';
import { PhotoLightbox } from '@/components/ui/photo-lightbox';
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [show3d, setShow3d] = useState(false);

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
          <div className="relative">
            <button
              type="button"
              onClick={() => product.photoUrls.length > 0 && setLightboxIndex(0)}
              className="flex h-44 w-full items-center justify-center overflow-hidden rounded-xl"
              style={{ background: 'var(--tg-secondary-bg)' }}
              disabled={product.photoUrls.length === 0}
            >
              {product.photoUrls.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                <img src={product.photoUrls[0]} alt={product.name} className="h-full w-full object-contain" />
              ) : (
                <span className="text-5xl">📦</span>
              )}
            </button>
            {product.modelUrl && (
              <button
                type="button"
                onClick={() => setShow3d(true)}
                className="absolute right-2 top-2 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md"
                style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
              >
                🧊 3D
              </button>
            )}
          </div>

          {product.photoUrls.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {product.photoUrls.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="h-14 w-14 shrink-0 overflow-hidden rounded-lg"
                  style={{ background: 'var(--tg-secondary-bg)', ...(i === lightboxIndex ? { boxShadow: '0 0 0 2px var(--tg-link)' } : {}) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL thumbnail */}
                  <img src={url} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}

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

      {product && lightboxIndex !== null && (
        <PhotoLightbox src={product.photoUrls[lightboxIndex]} alt={product.name} onClose={() => setLightboxIndex(null)} />
      )}
      {product?.modelUrl && show3d && <Model3DViewer src={product.modelUrl} onClose={() => setShow3d(false)} />}
    </MobileSheet>
  );
}
