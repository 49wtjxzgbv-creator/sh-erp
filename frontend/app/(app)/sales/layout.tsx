'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { href: '/sales', labelKey: 'customerOrders' },
  { href: '/sales/shipments', labelKey: 'shipments' },
] as const;

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('sales');
  const pathname = usePathname();
  const activeHref = pathname.startsWith('/sales/shipments') ? '/sales/shipments' : '/sales';

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
