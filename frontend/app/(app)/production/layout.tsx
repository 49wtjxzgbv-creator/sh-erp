'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { href: '/production', labelKey: 'orders' },
  { href: '/production/schedule', labelKey: 'schedule' },
  { href: '/production/stages', labelKey: 'stages' },
  { href: '/production/finished-goods', labelKey: 'finishedGoods' },
  { href: '/production/qc-checklist', labelKey: 'qcChecklist' },
  { href: '/production/work-tasks', labelKey: 'workTasksTitle' },
] as const;

function isTabActive(tab: (typeof TABS)[number], pathname: string): boolean {
  return tab.href === '/production'
    ? pathname === '/production' ||
        pathname.startsWith('/production/new') ||
        (/^\/production\/[^/]+$/.test(pathname) && !TABS.some((t) => t.href !== '/production' && pathname.startsWith(t.href)))
    : pathname.startsWith(tab.href);
}

export default function ProductionLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('production');
  const pathname = usePathname();
  const activeHref = TABS.find((tab) => isTabActive(tab, pathname))?.href ?? TABS[0].href;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Tabs value={activeHref}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.href} value={tab.href} asChild>
              <Link href={tab.href}>{t(tab.labelKey)}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  );
}
