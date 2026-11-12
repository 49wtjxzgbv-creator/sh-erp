'use client';

import { useEffect, useId, useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { StatusPill } from './status-pill';
import { ContactLinks } from './contact-links';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';
import { useCandidates, useCategoryProducts, useMe, useUpdateOutreach } from './use-sourcing-app';
import { OutreachLetterPanel } from './outreach-letter-panel';
import type { OutreachStatus } from './sourcing-app-client';

const STATUS_OPTIONS: Array<{ status: OutreachStatus; label: string }> = [
  { status: 'CONTACTED', label: '✅ Написав' },
  { status: 'RESPONDED', label: '📩 Відповіли' },
  { status: 'REJECTED', label: '❌ Відмовили' },
  { status: 'WON', label: '🏆 Домовились' },
];

/**
 * Shared candidate-supplier detail sheet (2026-11-10) — opened from a
 * product card, the Постачальники tab, or the Статус dashboard. Finds the
 * candidate within whatever `useCandidates()` list the opener already has
 * cached rather than fetching its own copy — there is no single
 * `GET /candidates/:id` endpoint (candidates are always browsed in a
 * list), and this avoids adding one just for this sheet.
 */
export function CandidateSheet({ candidateId, onClose }: { candidateId: string | null; onClose: () => void }) {
  const noteFieldId = useId();
  const priceFieldId = useId();
  const { data: candidates } = useCandidates();
  const candidate = candidates?.find((c) => c.id === candidateId) ?? null;
  const updateOutreach = useUpdateOutreach();
  // Already past the shell's own SDK-readiness gate by the time this sheet can even open.
  const { data: me } = useMe(true);

  const [note, setNote] = useState('');
  const [quotedPrice, setQuotedPrice] = useState('');
  const [saved, setSaved] = useState(false);
  const [productsPage, setProductsPage] = useState(0);

  useEffect(() => {
    setNote(candidate?.lastNote ?? '');
    setQuotedPrice(candidate?.quotedPriceEur != null ? String(candidate.quotedPriceEur) : '');
    setSaved(false);
    setProductsPage(0);
    // Deliberately keyed on candidate.id only — re-syncing on every
    // lastNote/quotedPriceEur change would overwrite the user's own
    // in-progress edit the instant our own save's query invalidation
    // refetches the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  // "в картці ймовірних постачальників потрібно додати поле які деталі
  // можливі до поставки бо фактично зараз ми бачимо тільки при генерації
  // пдф файла" (2026-11-12) — a candidate's own category IS its "what can
  // this supplier quote" scope (that's exactly how `OutreachLetterPanel`
  // itself already picks products for the letter), so this just reuses
  // the same category-products listing the Категорії tab already has,
  // scoped to `candidate.category.id` instead of the user picking a
  // category — no new backend endpoint needed.
  const { data: candidateProducts, isLoading: productsLoading } = useCategoryProducts(candidate?.category?.id ?? '', '', productsPage, undefined);

  function haptic(type: 'success' | 'error' = 'success') {
    getTelegramWebApp()?.HapticFeedback.notificationOccurred(type);
  }

  async function setStatus(status: OutreachStatus) {
    if (!candidate) return;
    try {
      await updateOutreach.mutateAsync({ candidateId: candidate.id, input: { status } });
      haptic('success');
    } catch {
      haptic('error');
      getTelegramWebApp()?.showAlert('Не вдалося оновити статус. Спробуйте ще раз.');
    }
  }

  async function saveNoteAndQuote() {
    if (!candidate) return;
    const input: { note?: string; quotedPriceEur?: number } = {};
    if (note !== (candidate.lastNote ?? '')) input.note = note;
    const parsedPrice = quotedPrice.trim() === '' ? undefined : Number(quotedPrice.replace(',', '.'));
    if (parsedPrice !== undefined && Number.isFinite(parsedPrice) && parsedPrice !== candidate.quotedPriceEur) {
      input.quotedPriceEur = parsedPrice;
    }
    if (Object.keys(input).length === 0) return;
    try {
      await updateOutreach.mutateAsync({ candidateId: candidate.id, input });
      haptic('success');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      haptic('error');
      getTelegramWebApp()?.showAlert('Не вдалося зберегти. Спробуйте ще раз.');
    }
  }

  return (
    <MobileSheet open={Boolean(candidateId)} onOpenChange={(open) => !open && onClose()} title={candidate?.name ?? 'Постачальник'}>
      {!candidate ? null : (
        <div className="space-y-4 pb-4">
          {candidate.category && (
            <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>{candidate.category.name}</p>
          )}
          {(candidate.region || candidate.location) && (
            <p className="text-sm">📍 {[candidate.region, candidate.location].filter(Boolean).join(', ')}</p>
          )}
          {candidate.whatTheyDo && <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>{candidate.whatTheyDo}</p>}
          <ContactLinks phone={candidate.phone} email={candidate.email} website={candidate.website} />

          {candidate.category && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>
                Можливі деталі{candidateProducts ? ` (${candidateProducts.total})` : ''}
              </p>
              {productsLoading ? (
                <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>Завантаження…</p>
              ) : !candidateProducts || candidateProducts.items.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>У категорії «{candidate.category.name}» ще немає товарів.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {candidateProducts.items.map((product) => (
                      <div key={product.id} className="flex items-center gap-2.5 rounded-lg p-1.5" style={{ background: 'var(--tg-secondary-bg)' }}>
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md" style={{ background: 'var(--tg-bg)' }}>
                          {product.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not an optimizable local/static asset
                            <img src={product.photoUrl} alt={product.name} className="h-full w-full object-contain" loading="lazy" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm">📦</div>
                          )}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-xs">{product.article} — {product.name}</p>
                      </div>
                    ))}
                  </div>
                  {(productsPage > 0 || candidateProducts.hasMore) && (
                    <div className="mt-2 flex items-center justify-center gap-2">
                      {productsPage > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setProductsPage((p) => p - 1)}>⬅️ Попередні</Button>
                      )}
                      {candidateProducts.hasMore && (
                        <Button variant="outline" size="sm" onClick={() => setProductsPage((p) => p + 1)}>Наступні ➡️</Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Статус</p>
            <StatusPill status={candidate.status} label={candidate.statusLabel} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.status}
                  type="button"
                  disabled={updateOutreach.isPending}
                  onClick={() => setStatus(opt.status)}
                  aria-pressed={candidate.status === opt.status}
                  className={cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors active:opacity-70 disabled:opacity-50')}
                  style={{ background: 'var(--tg-secondary-bg)', ...(candidate.status === opt.status ? { boxShadow: `0 0 0 2px var(--tg-link)` } : {}) }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label htmlFor={noteFieldId} className="mb-1.5 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Нотатка</label>
            <textarea
              id={noteFieldId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border p-2.5 text-sm"
              style={{ background: 'var(--tg-secondary-bg)', borderColor: 'transparent', color: 'var(--tg-text)' }}
              placeholder="напр. «подзвонили, думають до п'ятниці»"
            />
          </section>

          <section>
            <label htmlFor={priceFieldId} className="mb-1.5 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Названа ціна (€)</label>
            <Input id={priceFieldId} value={quotedPrice} onChange={(e) => setQuotedPrice(e.target.value)} placeholder="напр. 150.50" inputMode="decimal" />
          </section>

          <Button className="w-full" onClick={saveNoteAndQuote} loading={updateOutreach.isPending}>
            {saved ? '✅ Збережено' : 'Зберегти'}
          </Button>

          {me?.isAdmin && <OutreachLetterPanel candidateId={candidate.id} />}
        </div>
      )}
    </MobileSheet>
  );
}
