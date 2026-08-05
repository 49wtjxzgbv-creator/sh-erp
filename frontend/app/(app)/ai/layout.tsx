'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/ai', labelKey: 'help' },
  { href: '/ai/full-assistant', labelKey: 'fullAssistant' },
  { href: '/ai/order-qa', labelKey: 'orderQa' },
  { href: '/ai/invoice', labelKey: 'invoiceRecognition' },
  { href: '/ai/settings', labelKey: 'settingsTab' },
] as const;

export default function AiLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('ai');
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const active = tab.href === '/ai' ? pathname === '/ai' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
