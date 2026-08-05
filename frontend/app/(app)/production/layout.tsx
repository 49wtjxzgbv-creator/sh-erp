'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/production', labelKey: 'orders' },
  { href: '/production/stages', labelKey: 'stages' },
  { href: '/production/finished-goods', labelKey: 'finishedGoods' },
  { href: '/production/qc-checklist', labelKey: 'qcChecklist' },
] as const;

export default function ProductionLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('production');
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active =
            tab.href === '/production'
              ? pathname === '/production' || pathname.startsWith('/production/new') || /^\/production\/[^/]+$/.test(pathname)
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'border-b-2 px-3 py-2 text-sm transition-colors',
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
