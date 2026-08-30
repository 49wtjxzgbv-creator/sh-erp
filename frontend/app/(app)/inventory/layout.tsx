'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { href: '/inventory', labelKey: 'stockLevels' },
  { href: '/inventory/movements', labelKey: 'stockHistory' },
  { href: '/inventory/in-progress', labelKey: 'inProgress' },
  { href: '/inventory/finished-goods', labelKey: 'finishedGoods' },
  { href: '/inventory/warehouses', labelKey: 'warehouses' },
  { href: '/inventory/sessions', labelKey: 'sessions' },
  { href: '/inventory/expected', labelKey: 'expectedFromSupplier' },
] as const;

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('inventory');
  const pathname = usePathname();
  const activeHref =
    TABS.find((tab) => (tab.href === '/inventory' ? pathname === '/inventory' : pathname.startsWith(tab.href)))?.href ??
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
