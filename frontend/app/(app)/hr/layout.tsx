'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHasPermission, useMyPermissions } from '@/lib/hooks/use-roles';
import { LoadingBlock } from '@/components/ui/loading-block';

const TABS = [
  { href: '/hr', labelKey: 'employees', permission: 'employees:manage' },
  { href: '/hr/payroll', labelKey: 'payroll', permission: 'payroll:manage' },
] as const;

/**
 * Every route under `employees.controller.ts`/`payroll.controller.ts`
 * requires `employees:manage`/`payroll:manage` respectively — even plain
 * GET — so there is no read-only view a restricted role could land on
 * (unlike most other modules). Redirects away entirely if the caller has
 * neither, and hides whichever tab its own permission is missing.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('hr');
  const router = useRouter();
  const pathname = usePathname();
  const activeHref = pathname.startsWith('/hr/payroll') ? '/hr/payroll' : '/hr';
  const canEmployees = useHasPermission('employees:manage');
  const canPayroll = useHasPermission('payroll:manage');
  const { isSuccess } = useMyPermissions();
  const allowed = canEmployees || canPayroll;

  useEffect(() => {
    if (isSuccess && !allowed) router.replace('/dashboard');
  }, [isSuccess, allowed, router]);

  if (!isSuccess || !allowed) return <LoadingBlock />;

  const permissionGranted: Record<(typeof TABS)[number]['permission'], boolean> = {
    'employees:manage': canEmployees,
    'payroll:manage': canPayroll,
  };
  const tabs = TABS.filter((tab) => permissionGranted[tab.permission]);

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
