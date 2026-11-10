'use client';

import { useEffect, useId, useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { StatusPill } from './status-pill';
import { ContactLinks } from './contact-links';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';
import { useCandidates, useUpdateOutreach } from './use-sourcing-app';
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

  const [note, setNote] = useState('');
  const [quotedPrice, setQuotedPrice] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNote(candidate?.lastNote ?? '');
    setQuotedPrice(candidate?.quotedPriceEur != null ? String(candidate.quotedPriceEur) : '');
    setSaved(false);
    // Deliberately keyed on candidate.id only — re-syncing on every
    // lastNote/quotedPriceEur change would overwrite the user's own
    // in-progress edit the instant our own save's query invalidation
    // refetches the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

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
        </div>
      )}
    </MobileSheet>
  );
}
