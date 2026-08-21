'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Link2 } from 'lucide-react';
import { useSuppliers, useConnectExistingSupplier } from '@/lib/hooks/use-procurement';
import type { Supplier } from '@/lib/api-client/procurement';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';

/**
 * Search-and-connect (2026-08-21 P2) — for a supplier who already
 * self-registered a Supplier Portal account (no invite link, no Supplier
 * row here yet). Separate from "Новий постачальник" — that button creates
 * a Supplier row with no portal account at all; this one searches an
 * existing global account by exact email and requests a connection.
 */
function ConnectExistingSupplierDialog() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const connect = useConnectExistingSupplier();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await connect.mutateAsync({ email, name });
      setOpen(false);
      router.push(`/procurement/suppliers/${res.supplierId}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 className="mr-2 h-4 w-4" />
          {t('connectExistingSupplier')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('connectExistingSupplier')}</DialogTitle>
            <DialogDescription>{t('connectExistingSupplierDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="connect-email">{t('email')}</Label>
              <Input id="connect-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="connect-name">{t('supplierName')}</Label>
              <Input id="connect-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" loading={connect.isPending}>
              {t('connectExistingSupplierSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 50;

export default function SuppliersPage() {
  const t = useTranslations('procurement');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useSuppliers({ search: search || undefined, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      { accessorKey: 'name', header: t('supplierName') },
      { accessorKey: 'contactPerson', header: t('contactPerson'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'phone', header: t('phone'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'email', header: t('email'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="max-w-sm"
        />
        {useHasPermission('suppliers:write') && (
          <div className="flex gap-2">
            <ConnectExistingSupplierDialog />
            <Button asChild>
              <Link href="/procurement/suppliers/new">
                <Plus className="mr-2 h-4 w-4" />
                {t('newSupplier')}
              </Link>
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(supplier) => router.push(`/procurement/suppliers/${supplier.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
