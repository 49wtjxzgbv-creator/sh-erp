'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getTelegramWebApp } from './telegram-webapp';
import { useUpsertNote } from './use-sourcing-app';

/**
 * "нотатки до товару/постачальника — короткий текстовий комент, видимий
 * усій команді" (2026-11-10) — one shared note per entity, last-write-wins
 * (no per-user list/thread). Shared between ProductSheet and
 * SupplierSheet rather than duplicated — same entityType/entityId shape
 * both already pass around for other lookups.
 */
export function NoteEditor({ entityType, entityId, note }: { entityType: 'Product' | 'Supplier'; entityId: string; note: string | null }) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? '');
  const upsertNote = useUpsertNote();

  // New entity (or a save from elsewhere landed) — drop any stale draft.
  useEffect(() => {
    setValue(note ?? '');
    setEditing(false);
  }, [entityId, note]);

  // "зберіг нотатку і нічого не відбулось" (2026-11-11) — the mutation had
  // no error handling at all; a failed save used to look identical to a
  // successful one (editor just closed either way). Matches the
  // try/catch+haptic+showAlert convention every other mutation in this app
  // already follows (AddCandidateSheet, CandidateSheet).
  async function save() {
    try {
      await upsertNote.mutateAsync({ entityType, entityId, note: value });
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
      setEditing(false);
    } catch {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      getTelegramWebApp()?.showAlert('Не вдалося зберегти нотатку. Спробуйте ще раз.');
    }
  }

  if (editing) {
    return (
      <section>
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Нотатка команди</label>
        <textarea
          id={fieldId}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-lg p-2.5 text-sm outline-none"
          style={{ background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
          placeholder="Коротка нотатка, видима всій команді…"
        />
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" onClick={save} loading={upsertNote.isPending}>Зберегти</Button>
          <Button size="sm" variant="outline" onClick={() => { setValue(note ?? ''); setEditing(false); }}>Скасувати</Button>
        </div>
      </section>
    );
  }

  if (!note) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-xs" style={{ color: 'var(--tg-link)' }}>
        ➕ Додати нотатку
      </button>
    );
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Нотатка команди</p>
        {/* "-m-2 p-2" keeps the ✏️ glyph visually unchanged while widening the actual tap target toward the ~44px convention every other icon-only button in this app uses (DocumentPreview/Model3DViewer close buttons). */}
        <button type="button" onClick={() => setEditing(true)} aria-label="Редагувати нотатку" className="-m-2 rounded-full p-2">✏️</button>
      </div>
      <p className="whitespace-pre-wrap rounded-lg p-2.5 text-sm" style={{ background: 'var(--tg-secondary-bg)' }}>{note}</p>
    </section>
  );
}
