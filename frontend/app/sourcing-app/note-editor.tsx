'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUpsertNote } from './use-sourcing-app';

/**
 * "нотатки до товару/постачальника — короткий текстовий комент, видимий
 * усій команді" (2026-11-10) — one shared note per entity, last-write-wins
 * (no per-user list/thread). Shared between ProductSheet and
 * SupplierSheet rather than duplicated — same entityType/entityId shape
 * both already pass around for other lookups.
 */
export function NoteEditor({ entityType, entityId, note }: { entityType: 'Product' | 'Supplier'; entityId: string; note: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? '');
  const upsertNote = useUpsertNote();

  // New entity (or a save from elsewhere landed) — drop any stale draft.
  useEffect(() => {
    setValue(note ?? '');
    setEditing(false);
  }, [entityId, note]);

  async function save() {
    await upsertNote.mutateAsync({ entityType, entityId, note: value });
    setEditing(false);
  }

  if (editing) {
    return (
      <section>
        <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Нотатка команди</p>
        <textarea
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
        <button type="button" onClick={() => setEditing(true)} aria-label="Редагувати нотатку">✏️</button>
      </div>
      <p className="whitespace-pre-wrap rounded-lg p-2.5 text-sm" style={{ background: 'var(--tg-secondary-bg)' }}>{note}</p>
    </section>
  );
}
