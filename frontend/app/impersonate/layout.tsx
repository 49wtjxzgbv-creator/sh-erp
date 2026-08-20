import type { Metadata } from 'next';

/** Internal redirect-landing utility (Super Admin "impersonate" flow) — not a real page, never indexable. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ImpersonateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
