'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHasPermission } from '@/lib/hooks/use-roles';

const TABS = [
  { href: '/procurement', labelKey: 'purchaseOrders' },
  { href: '/procurement/suppliers', labelKey: 'suppliers', permission: 'suppliers:read' },
] as const;

export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('procurement');
  const pathname = usePathname();
  const activeHref = pathname.startsWith('/procurement/suppliers') ? '/procurement/suppliers' : '/procurement';
  const canReadSuppliers = useHasPermission('suppliers:read');
  const tabs = TABS.filter((tab) => !('permission' in tab) || canReadSuppliers);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Tabs value={activeHref}>
        <TabsList>
          {tabs.map((tab) => (
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
