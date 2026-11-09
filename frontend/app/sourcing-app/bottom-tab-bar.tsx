'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getTelegramWebApp } from './telegram-webapp';

const TABS = [
  { href: '/sourcing-app', label: 'Категорії', icon: '📂' },
  { href: '/sourcing-app/search', label: 'Пошук', icon: '🔎' },
  { href: '/sourcing-app/suppliers', label: 'Постачальники', icon: '🏭' },
  { href: '/sourcing-app/status', label: 'Статус', icon: '📊' },
];

/** Persistent bottom nav (2026-11-10) — the Mini App's equivalent of the bot's own reply keyboard, now a real native-feeling tab bar. */
export function BottomTabBar() {
  const pathname = usePathname();

  function handleTap() {
    getTelegramWebApp()?.HapticFeedback.impactOccurred('light');
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-[var(--tg-secondary-bg)] pb-[env(safe-area-inset-bottom)]" style={{ borderColor: 'color-mix(in srgb, var(--tg-hint) 25%, transparent)' }}>
      {TABS.map((tab) => {
        const active = tab.href === '/sourcing-app' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={handleTap}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
              active ? 'text-[var(--tg-link)]' : 'text-[var(--tg-hint)]',
            )}
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
