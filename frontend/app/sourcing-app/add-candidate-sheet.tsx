'use client';

import { useEffect, useId, useState } from 'react';
import { MobileSheet } from './mobile-sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getTelegramWebApp } from './telegram-webapp';
import { useCategories, useCreateCandidate } from './use-sourcing-app';

/**
 * Admin-only "➕ Додати постачальника" form (2026-11-10 — "має бути
 * можливість додавати можливих постачальників"), the Mini App's form
 * equivalent of the bot's own admin-only text flow.
 *
 * "дододай щоб також можливого постачальника можна було додати у картці
 * товару" (2026-11-10) — `fixedCategory`, when provided (opened from a
 * product card), locks the category to that product's own one instead of
 * showing the picker — a candidate added from a product card is obviously
 * meant for that product's category, so asking the admin to re-pick it
 * would just be friction.
 *
 * `productId`, when provided (opened from a product card), is passed
 * through to `useCreateCandidate` purely so its own cache invalidation can
 * refresh that product's own `candidateSuppliers` list (2026-11-11 — a
 * candidate added this way used to stay invisible on the product card
 * until it was closed and reopened).
 */
export function AddCandidateSheet({
  open,
  onClose,
  fixedCategory,
  productId,
}: {
  open: boolean;
  onClose: () => void;
  fixedCategory?: { id: string; name: string };
  productId?: string;
}) {
  const categoryFieldId = useId();
  const nameFieldId = useId();
  const regionFieldId = useId();
  const locationFieldId = useId();
  const phoneFieldId = useId();
  const emailFieldId = useId();
  const websiteFieldId = useId();
  const whatTheyDoFieldId = useId();
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

  useEffect(() => {
    if (open) setCategoryId(fixedCategory?.id ?? '');
  }, [open, fixedCategory?.id]);

  function reset() {
    setCategoryId(fixedCategory?.id ?? '');
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
        productId,
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
        {fixedCategory ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Категорія</p>
            <p className="rounded-lg p-2.5 text-sm" style={fieldStyle}>{fixedCategory.name}</p>
          </div>
        ) : (
          <div>
            <label htmlFor={categoryFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Категорія *</label>
            <select
              id={categoryFieldId}
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
        )}

        <div>
          <label htmlFor={nameFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Назва *</label>
          <Input id={nameFieldId} value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. ТОВ «Метиз Капітал»" />
        </div>

        <div>
          <label htmlFor={regionFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Область</label>
          <Input id={regionFieldId} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="напр. Хмельницька обл." />
        </div>

        <div>
          <label htmlFor={locationFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Місто/адреса</label>
          <Input id={locationFieldId} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="напр. м. Хмельницький, вул. ..." />
        </div>

        <div>
          <label htmlFor={phoneFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Телефон</label>
          <Input id={phoneFieldId} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380..." inputMode="tel" />
        </div>

        <div>
          <label htmlFor={emailFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Email</label>
          <Input id={emailFieldId} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@..." inputMode="email" />
        </div>

        <div>
          <label htmlFor={websiteFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Сайт</label>
          <Input id={websiteFieldId} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" />
        </div>

        <div>
          <label htmlFor={whatTheyDoFieldId} className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Що роблять</label>
          <textarea
            id={whatTheyDoFieldId}
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
