'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { href: '/reports', labelKey: 'reorderSuggestions' },
  { href: '/reports/valuation', labelKey: 'warehouseValuation' },
  { href: '/reports/production-rollup', labelKey: 'productionRollup' },
] as const;

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('reports');
  const pathname = usePathname();
  const activeHref =
    TABS.find((tab) => (tab.href === '/reports' ? pathname === '/reports' : pathname.startsWith(tab.href)))?.href ??
    TABS[0].href;

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
