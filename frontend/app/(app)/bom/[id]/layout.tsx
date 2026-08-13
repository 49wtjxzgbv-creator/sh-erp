'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useAssembly, useDeleteAssembly } from '@/lib/hooks/use-bom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

function tabsFor(id: string) {
  return [
    { href: `/bom/${id}`, labelKey: 'assemblyHeader' },
    { href: `/bom/${id}/components`, labelKey: 'tabBom' },
    { href: `/bom/${id}/cost`, labelKey: 'tabCost' },
    { href: `/bom/${id}/availability`, labelKey: 'tabAvailability' },
    { href: `/bom/${id}/versions`, labelKey: 'tabVersions' },
  ] as const;
}

export default function AssemblyLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('bom');
  const tc = useTranslations('common');

  const { data: assembly } = useAssembly(params.id);
  const deleteAssembly = useDeleteAssembly();

  const tabs = tabsFor(params.id);

  async function handleDelete() {
    await deleteAssembly.mutateAsync(params.id);
    router.replace('/bom');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{assembly?.name ?? '…'}</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              {tc('delete')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button variant="destructive" loading={deleteAssembly.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/*
       * Each "tab" is a real route (Next layout swaps `children`), not a
       * content panel Tabs itself owns — so TabsContent is deliberately
       * unused here. Tabs/TabsList/TabsTrigger are reused purely for the
       * shared underline styling + roving-tabindex keyboard nav; `value` is
       * just the current pathname, `onValueChange` is a no-op since Link
       * inside TabsTrigger (asChild) is what actually navigates.
       */}
      <Tabs value={tabs.find((tab) => tab.href === pathname)?.href ?? tabs[0].href}>
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
