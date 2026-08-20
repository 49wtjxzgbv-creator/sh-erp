import type { Metadata } from 'next';

/**
 * Unique title/description for the real conversion page (kept indexable,
 * unlike /login) — otherwise it would inherit the root layout's generic
 * product-wide title/description verbatim, with nothing distinguishing it
 * from "/" for search engines.
 */
export const metadata: Metadata = {
  title: 'Реєстрація компанії',
  description:
    'Створіть обліковий запис компанії в SH ERP безкоштовно за 2 хвилини — виробництво, склад, закупівлі та продажі в одній системі.',
  alternates: { canonical: '/register' },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
