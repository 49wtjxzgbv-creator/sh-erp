'use client';

import { useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getTelegramWebApp } from './telegram-webapp';
import { useCategories, useCreateCandidate } from './use-sourcing-app';

/** Admin-only "➕ Додати постачальника" form (2026-11-10 — "має бути можливість додавати можливих постачальників"), the Mini App's form equivalent of the bot's own admin-only text flow. */
export function AddCandidateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: categories } = useCategories();
  const createCandidate = useCreateCandidate();

  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [whatTheyDo, setWhatTheyDo] = useState('');

  function reset() {
    setCategoryId('');
    setName('');
    setRegion('');
    setLocation('');
    setPhone('');
    setEmail('');
    setWebsite('');
    setWhatTheyDo('');
  }

  async function handleSubmit() {
    if (!categoryId || !name.trim()) return;
    try {
      await createCandidate.mutateAsync({
        categoryId,
        name: name.trim(),
        region: region.trim() || undefined,
        location: location.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        whatTheyDo: whatTheyDo.trim() || undefined,
      });
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
      reset();
      onClose();
    } catch {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      getTelegramWebApp()?.showAlert('Не вдалося додати постачальника. Спробуйте ще раз.');
    }
  }

  const fieldStyle = { background: 'var(--tg-secondary-bg)', borderColor: 'transparent', color: 'var(--tg-text)' };

  return (
    <MobileSheet open={open} onOpenChange={(o) => !o && onClose()} title="Додати постачальника">
      <div className="space-y-3 pb-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Категорія *</p>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-lg border p-2.5 text-sm"
            style={fieldStyle}
          >
            <option value="">— Оберіть категорію —</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Назва *</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. ТОВ «Метиз Капітал»" />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Область</p>
          <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="напр. Хмельницька обл." />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Місто/адреса</p>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="напр. м. Хмельницький, вул. ..." />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Телефон</p>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380..." inputMode="tel" />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Email</p>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@..." inputMode="email" />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Сайт</p>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Що роблять</p>
          <textarea
            value={whatTheyDo}
            onChange={(e) => setWhatTheyDo(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border p-2.5 text-sm"
            style={fieldStyle}
            placeholder="напр. виробництво стандартних метизів"
          />
        </div>

        <Button className="w-full" onClick={handleSubmit} loading={createCandidate.isPending} disabled={!categoryId || !name.trim()}>
          Додати
        </Button>
      </div>
    </MobileSheet>
  );
}
