'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const activeHref =
    TABS.find((tab) => (tab.href === '/ai' ? pathname === '/ai' : pathname.startsWith(tab.href)))?.href ?? TABS[0].href;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Tabs value={activeHref}>
        <TabsList className="overflow-x-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.href} value={tab.href} className="whitespace-nowrap" asChild>
              <Link href={tab.href}>{t(tab.labelKey)}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  );
}
