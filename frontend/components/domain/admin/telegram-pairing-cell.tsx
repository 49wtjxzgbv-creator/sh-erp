'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGenerateTelegramPairingCodeForUser, useUnlinkTelegramForUser } from '@/lib/hooks/use-users';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

/**
 * "Підписати в бот ще одного адміністратора" (2026-10-06 user request) —
 * the self-service pairing card on /notifications only lets a user pair
 * THEIR OWN account; this is the admin-initiated counterpart (users:manage,
 * see users.service.ts#generateTelegramPairingCodeForUser) for a colleague
 * who won't log into the ERP themselves. Shown as a cell per row on the
 * /admin users table, not a dedicated page — this table already lists
 * every company member.
 */
export function TelegramPairingCell({ userId, fullName, telegramPaired }: { userId: string; fullName: string | null; telegramPaired: boolean }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const generateCode = useGenerateTelegramPairingCodeForUser();
  const unlinkTelegram = useUnlinkTelegramForUser();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      const result = await generateCode.mutateAsync(userId);
      setGeneratedCode({ code: result.pairingCode, expiresAt: result.expiresAt });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleUnlink() {
    setError(null);
    try {
      await unlinkTelegram.mutateAsync(userId);
      setOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setGeneratedCode(null); } }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {telegramPaired ? (
            <Badge variant="success" className="mr-1">
              {t('telegramPaired')}
            </Badge>
          ) : null}
          Telegram
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Telegram — {fullName}</DialogTitle>
          <DialogDescription>{telegramPaired ? t('telegramPairedDescription') : t('telegramNotPairedDescription')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {telegramPaired ? (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={unlinkTelegram.isPending} onClick={handleUnlink}>
              {t('telegramUnlink')}
            </Button>
          </DialogFooter>
        ) : generatedCode ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground">{t('telegramCodeLabel')}</p>
              <p className="font-mono text-2xl font-semibold tracking-widest">{generatedCode.code}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('telegramCodeExpiresAt', { time: new Date(generatedCode.expiresAt).toLocaleTimeString() })}</p>
            </div>
            <p className="text-sm text-muted-foreground">{t('telegramCodeInstructions')}</p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>{tc('close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button loading={generateCode.isPending} onClick={handleGenerate}>
              {t('telegramGenerateCode')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
