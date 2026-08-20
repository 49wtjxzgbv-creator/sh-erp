import type { Metadata } from 'next';
import { SuperAdminShell } from './super-admin-shell';

/** Platform-operator tooling, not customer-facing — never indexable. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
