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
  { href: '/admin', labelKey: 'users', permission: 'users:manage' },
  { href: '/admin/roles', labelKey: 'roles', permission: 'roles:manage' },
  { href: '/admin/audit', labelKey: 'auditLog', permission: 'audit:read' },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const pathname = usePathname();
  const activeHref =
    TABS.find((tab) => (tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)))?.href ?? TABS[0].href;
  const canUsers = useHasPermission('users:manage');
  const canRoles = useHasPermission('roles:manage');
  const canAudit = useHasPermission('audit:read');
  const { isSuccess } = useMyPermissions();
  const allowed = canUsers || canRoles || canAudit;

  useEffect(() => {
    if (isSuccess && !allowed) router.replace('/dashboard');
  }, [isSuccess, allowed, router]);

  if (!isSuccess || !allowed) return <LoadingBlock />;

  const permissionGranted: Record<(typeof TABS)[number]['permission'], boolean> = {
    'users:manage': canUsers,
    'roles:manage': canRoles,
    'audit:read': canAudit,
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
