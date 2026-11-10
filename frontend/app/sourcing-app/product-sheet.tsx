'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MobileSheet } from './mobile-sheet';
import { PriceChips } from './price-chips';
import { StatusPill } from './status-pill';
import { Model3DViewer } from './model-3d-viewer';
import { DocumentPreview } from './document-preview';
import { AddCandidateSheet } from './add-candidate-sheet';
import { NoteEditor } from './note-editor';
import { RealSupplierRow } from './real-supplier-row';
import { formatWeightKg } from './format-weight';
import { PhotoLightbox } from '@/components/ui/photo-lightbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getTelegramWebApp } from './telegram-webapp';
import { useProductDetail, useMe, useTranslateName } from './use-sourcing-app';

function documentIcon(name: string): string {
  return /\.pdf$/i.test(name) ? '📕' : '📐';
}

export function ProductSheet({
  productId,
  onClose,
  onOpenCandidate,
}: {
  productId: string | null;
  onClose: () => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const router = useRouter();
  const { data: product, isLoading } = useProductDetail(productId);
  // Already past the shell's own SDK-readiness gate by the time this sheet can even open.
  const { data: me } = useMe(true);
  // "додай можливість перекладу назв товарів на українську" (2026-11-10) — called with a hook's own key, not a mutation, so retapping the same name reuses the cached translation (see useTranslateName's own comment).
  const { data: translation, error: translateError, refetch: translate, isFetching: isTranslating } = useTranslateName(product?.name ?? '');
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [show3d, setShow3d] = useState(false);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; name: string; url: string } | null>(null);

  // "при закриті і відкритті цього ж товару постійно відкривається 3д чи
  // фото" (2026-11-10 real user report): this component never unmounts
  // between opens (the parent page just toggles `productId` while
  // `<ProductSheet>` itself stays mounted), so leftover `lightboxIndex`/
  // `show3d` state from a PREVIOUS visit silently reopened the lightbox or
  // 3D viewer the instant the sheet reopened — even for a different
  // product. Reset on every open/close/product-switch.
  useEffect(() => {
    setLightboxIndex(null);
    setShow3d(false);
    setShowAddCandidate(false);
    setPreviewDoc(null);
    setCopied(false);
  }, [productId]);

  function openAssembly(assemblyId: string) {
    onClose();
    router.push(`/sourcing-app/assemblies/${assemblyId}`);
  }

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
            <div className="flex items-start justify-between gap-2">
              <p className="text-base font-semibold">{product.name}</p>
              <button
                type="button"
                onClick={() => translate()}
                disabled={isTranslating}
                className="shrink-0 rounded-full px-2 py-1 text-xs font-medium disabled:opacity-50"
                style={{ background: 'var(--tg-secondary-bg)' }}
                aria-label="Перекласти назву українською"
              >
                {isTranslating ? '…' : '🇺🇦'}
              </button>
            </div>
            {translation && <p className="mt-0.5 text-sm" style={{ color: 'var(--tg-link)' }}>{translation.translated}</p>}
            {/* "натискаю і нічого не відбувається" (2026-11-10) — a failed translate call used to fail silently; now surfaced so a provider/key issue is visible instead of looking like a dead button. */}
            {translateError && <p className="mt-0.5 text-sm text-red-500">{translateError instanceof Error ? translateError.message : 'Переклад не вдався.'}</p>}
            <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
              {product.article}
              {product.weightKg !== null && ` · ⚖️ ${formatWeightKg(product.weightKg)}`}
            </p>
          </div>

          <NoteEditor entityType="Product" entityId={product.id} note={product.note} />

          {/* "в описі також має писати до якого виробу специфікації він
              належить" (2026-11-10) */}
          {product.usedInAssemblies.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Входить до виробу</p>
              <div className="space-y-1.5">
                {product.usedInAssemblies.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openAssembly(a.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left text-sm active:opacity-70"
                    style={{ background: 'var(--tg-secondary-bg)' }}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ background: 'var(--tg-bg)' }}>
                      {a.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL thumbnail
                        <img src={a.photoUrl} alt="" className="h-full w-full object-contain" />
                      ) : (
                        '🏭'
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {a.article && <span style={{ color: 'var(--tg-hint)' }}>{a.article} — </span>}
                      {a.name}
                    </span>
                    <span style={{ color: 'var(--tg-hint)' }}>›</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Наші ціни</p>
            <PriceChips prices={product.prices} />
          </section>

          {product.realSuppliers.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Наявні постачальники</p>
              <div className="space-y-2">
                {product.realSuppliers.map((s) => (
                  <RealSupplierRow key={s.id} productId={product.id} supplier={s} canPropose={Boolean(me?.isAdmin)} />
                ))}
              </div>
            </section>
          )}

          {product.documents.length > 0 && (
            <section>
              {/* "щоб у картку товару підтягувався пдф файл і dxf якщо вони є" (2026-11-10) */}
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Документи</p>
              <div className="space-y-1.5">
                {product.documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setPreviewDoc(doc)}
                    className="flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm active:opacity-70"
                    style={{ background: 'var(--tg-secondary-bg)' }}
                  >
                    <span>{documentIcon(doc.name)}</span>
                    <span className="truncate">{doc.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(product.candidateSuppliers.length > 0 || (me?.isAdmin && product.category)) && (
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
                {/* "дододай щоб також можливого постачальника можна було додати у картці товару" (2026-11-10) — locked to this product's own category, see AddCandidateSheet's own comment. */}
                {me?.isAdmin && product.category && (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddCandidate(true)}>
                    ➕ Додати постачальника
                  </Button>
                )}
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
      <DocumentPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      {product?.category && (
        <AddCandidateSheet open={showAddCandidate} onClose={() => setShowAddCandidate(false)} fixedCategory={product.category} />
      )}
    </MobileSheet>
  );
}
