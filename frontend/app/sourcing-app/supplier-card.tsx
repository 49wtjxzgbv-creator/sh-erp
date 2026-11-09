'use client';

import { formatEur } from '@/lib/utils';
import { ContactLinks } from './contact-links';
import type { RealSupplier } from './sourcing-app-client';

export function SupplierCard({ supplier }: { supplier: RealSupplier }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--tg-section-bg)' }}>
      <p className="text-sm font-semibold">🏭 {supplier.name}</p>
      <ContactLinks phone={supplier.phone} email={supplier.email} website={null} />
      <p className="mt-2 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>
        {supplier.products.length} товар{supplier.products.length === 1 ? '' : supplier.products.length < 5 ? 'и' : 'ів'}
      </p>
      <div className="mt-1 space-y-1">
        {supplier.products.slice(0, 5).map((p) => (
          <p key={p.id} className="text-xs" style={{ color: 'var(--tg-hint)' }}>
            {p.article} — {p.name}
            {p.ourPrice !== null && ` · ${formatEur(p.ourPrice)}`}
          </p>
        ))}
        {supplier.products.length > 5 && (
          <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>і ще {supplier.products.length - 5}…</p>
        )}
      </div>
    </div>
  );
}
