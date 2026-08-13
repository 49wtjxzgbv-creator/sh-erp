'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useSupplier, useUpdateSupplier, useDeleteSupplier, useInvitePortal, useDeactivatePortal } from '@/lib/hooks/use-procurement';
import { SupplierForm } from '@/components/domain/procurement/supplier-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateSupplierInput } from '@/lib/api-client/procurement';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/loading-block';
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

/** ADR-0011's onboarding card — mirrors app/super-admin/users/page.tsx's ResetPasswordDialog UX: show the generated temp password once, with a copy button, since it can't be retrieved again after this response. */
function SupplierPortalCard({ supplierId }: { supplierId: string }) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const { data: supplier } = useSupplier(supplierId);
  const invite = useInvitePortal(supplierId);
  const deactivate = useDeactivatePortal(supplierId);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supplier) return null;
  const portalUser = supplier.portalUser;

  async function handleInvite() {
    setError(null);
    setTempPassword(null);
    setCopied(false);
    try {
      const res = await invite.mutateAsync({});
      setTempPassword(res.tempPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDeactivate() {
    setError(null);
    try {
      await deactivate.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('supplierPortalCardTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {portalUser ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">{portalUser.email}</span>
            <Badge variant={portalUser.active ? 'success' : 'secondary'}>
              {portalUser.active ? t('portalActive') : t('portalDeactivated')}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noPortalAccount')}</p>
        )}

        {tempPassword && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{t('portalPasswordGenerated')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
                {tempPassword}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(tempPassword);
                  setCopied(true);
                }}
              >
                {copied ? tc('copied') : tc('copy')}
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" loading={invite.isPending} onClick={handleInvite}>
            {portalUser ? t('resetPortalPassword') : t('invitePortal')}
          </Button>
          {portalUser?.active && (
            <Button size="sm" variant="destructive" loading={deactivate.isPending} onClick={handleDeactivate}>
              {t('deactivatePortal')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');

  const { data: supplier, isLoading } = useSupplier(params.id);
  const updateSupplier = useUpdateSupplier(params.id);
  const deleteSupplier = useDeleteSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateSupplierInput) {
    setError(null);
    try {
      await updateSupplier.mutateAsync(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete() {
    await deleteSupplier.mutateAsync(params.id);
    router.replace('/procurement/suppliers');
  }

  if (isLoading || !supplier) {
    return <LoadingBlock />;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{supplier.name}</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              {tc('delete')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteSupplierConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteSupplierConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button variant="destructive" loading={deleteSupplier.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <SupplierForm supplier={supplier} onSubmit={handleSubmit} submitting={updateSupplier.isPending} submitError={error} />
      <SupplierPortalCard supplierId={params.id} />
    </div>
  );
}
