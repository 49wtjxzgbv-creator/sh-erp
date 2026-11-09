'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGenerateSourcingBotPairingCodeForUser, useUnlinkSourcingBotForUser } from '@/lib/hooks/use-users';
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
 * Public Telegram bot username — not a secret, see notifications/page.tsx's
 * SOURCING_BOT_USERNAME comment for why this is hardcoded rather than a
 * NEXT_PUBLIC_* env var (those are build-time baked, a username change
 * would otherwise force a rebuild either way).
 */
const SOURCING_BOT_USERNAME = 'sherp_vpbot';

/**
 * "я сам не можу генерувати посилання іншим користувачам" (2026-11-09) —
 * the self-service pairing card on /notifications only lets a user pair
 * THEIR OWN account; this is the admin-initiated counterpart (users:manage,
 * see users.service.ts#generateSourcingBotPairingCodeForUser) so an admin
 * can invite a colleague (procurement staff who may never otherwise log
 * into the ERP) with a single link, mirroring TelegramPairingCell's shape
 * exactly. Shown as a cell per row on the /admin users table.
 */
export function SourcingBotPairingCell({ userId, fullName, sourcingBotPaired }: { userId: string; fullName: string | null; sourcingBotPaired: boolean }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const generateCode = useGenerateSourcingBotPairingCodeForUser();
  const unlinkSourcingBot = useUnlinkSourcingBotForUser();
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
      await unlinkSourcingBot.mutateAsync(userId);
      setOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setGeneratedCode(null); } }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {sourcingBotPaired ? (
            <Badge variant="success" className="mr-1">
              {t('sourcingBotPaired')}
            </Badge>
          ) : null}
          Sourcing bot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sourcing bot — {fullName}</DialogTitle>
          <DialogDescription>{sourcingBotPaired ? t('sourcingBotPairedDescription') : t('sourcingBotNotPairedDescription')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {sourcingBotPaired ? (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={unlinkSourcingBot.isPending} onClick={handleUnlink}>
              {t('sourcingBotUnlink')}
            </Button>
          </DialogFooter>
        ) : generatedCode ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground">{t('sourcingBotCodeLabel')}</p>
              <p className="font-mono text-2xl font-semibold tracking-widest">{generatedCode.code}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('sourcingBotCodeExpiresAt', { time: new Date(generatedCode.expiresAt).toLocaleTimeString() })}</p>
            </div>
            <Button asChild size="sm" className="w-full">
              <a href={`https://t.me/${SOURCING_BOT_USERNAME}?start=${generatedCode.code}`} target="_blank" rel="noopener noreferrer">
                {t('sourcingBotOpenLink')}
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">{t('sourcingBotCodeInstructions')}</p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>{tc('close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button loading={generateCode.isPending} onClick={handleGenerate}>
              {t('sourcingBotGenerateCode')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
