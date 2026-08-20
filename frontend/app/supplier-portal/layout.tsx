import type { Metadata } from 'next';
import { SupplierPortalShell } from './supplier-portal-shell';

/** Real supplier purchase-order data behind its own auth — never indexable. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SupplierPortalLayout({ children }: { children: React.ReactNode }) {
  return <SupplierPortalShell>{children}</SupplierPortalShell>;
}
