import type { Metadata, Viewport } from 'next';
import { SourcingAppShell } from './sourcing-app-shell';

/** Lives only inside Telegram, behind Telegram's own auth — never indexable, never a crawl target. */
export const metadata: Metadata = {
  title: 'Пошук постачальників',
  robots: { index: false, follow: false },
};

/** Telegram Mini Apps run full-viewport with no browser chrome — matches the native-app expectation this whole route is designed around. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function SourcingAppLayout({ children }: { children: React.ReactNode }) {
  return <SourcingAppShell>{children}</SourcingAppShell>;
}
