'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLowStockDigestPreview, useSendLowStockDigestNow } from '@/lib/hooks/use-notifications';
import { useCompanySettings } from '@/lib/hooks/use-settings';
import { useMyProfile, useGenerateMyTelegramPairingCode, useUnlinkMyTelegram } from '@/lib/hooks/use-users';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

/**
 * Low-stock digest — the only notification this module has (Automation.gs'
 * `dailyLowStockDigest_`, ported in low-stock-digest.service.ts). No
 * schedule/calendar UI here: there is genuinely no automatic daily send
 * wired up anywhere in the backend yet (no BullMQ/Redis queue exists in
 * this codebase — confirmed from the service's own header comment), so
 * "send now" really is the only send path today, not a manual override of
 * a schedule that also runs on its own.
 */
export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: settings } = useCompanySettings();
  const { data: preview, isLoading: previewLoading, refetch } = useLowStockDigestPreview();
  const sendNow = useSendLowStockDigestNow();

  const [sendResult, setSendResult] = useState<{ sent: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const digestReady = !!settings?.dailyDigestEnabled && !!settings?.dailyDigestEmail;

  async function handleSendNow() {
    setError(null);
    setSendResult(null);
    try {
      const result = await sendNow.mutateAsync();
      setSendResult(result);
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('lowStockDigest')}</CardTitle>
          <CardDescription>{t('lowStockDigestDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {digestReady ? (
              <Badge variant="success">{t('digestEnabled')}</Badge>
            ) : (
              <Badge variant="warning">{t('digestNotConfigured')}</Badge>
            )}
            {!digestReady && (
              <Link href="/settings" className="text-xs text-primary underline-offset-4 hover:underline">
                {t('configureInSettings')}
              </Link>
            )}
          </div>

          {previewLoading ? (
            <LoadingBlock />
          ) : preview ? (
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <p className="font-medium">{preview.subject}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('lowStockCount', { count: preview.lowStockCount })} · {t('imminentCount', { count: preview.imminentForecastCount })}
              </p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{preview.body}</pre>
            </div>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {sendResult && (
            <p className={sendResult.sent ? 'text-sm text-success' : 'text-sm text-warning'}>
              {sendResult.sent ? t('sendSuccess') : sendResult.reason}
            </p>
          )}

          <Button onClick={handleSendNow} loading={sendNow.isPending}>
            {t('sendNow')}
          </Button>
        </CardContent>
      </Card>

      <TelegramSupervisorCard />
    </div>
  );
}

/**
 * "Сповіщення керівнику в Telegram" (2026-10-01) — self-service opt-in for
 * the SAME shared platform bot employees use to submit work
 * (TelegramBotService#notifySupervisors): pair here once, and any
 * bot-submitted DRAFT gets pushed to you with inline ✅/❌ for as long as
 * your role holds "Підтвердити виконання" — re-checked live at send/tap
 * time, never cached from pairing time.
 */
function TelegramSupervisorCard() {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: profile } = useMyProfile();
  const generateCode = useGenerateMyTelegramPairingCode();
  const unlinkTelegram = useUnlinkMyTelegram();
  const [error, setError] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      const result = await generateCode.mutateAsync();
      setGeneratedCode({ code: result.pairingCode, expiresAt: result.expiresAt });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleUnlink() {
    setError(null);
    setGeneratedCode(null);
    try {
      await unlinkTelegram.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const isPaired = Boolean(profile?.telegramPaired);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t('telegramSupervisorTitle')}
          {isPaired ? <Badge variant="success">{t('telegramSupervisorPaired')}</Badge> : <Badge variant="secondary">{t('telegramSupervisorNotPaired')}</Badge>}
        </CardTitle>
        <CardDescription>{t('telegramSupervisorDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {isPaired ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                {t('telegramSupervisorUnlink')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('telegramSupervisorUnlinkConfirmTitle')}</DialogTitle>
                <DialogDescription>{t('telegramSupervisorUnlinkConfirmDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{tc('cancel')}</Button>
                </DialogClose>
                <Button variant="destructive" loading={unlinkTelegram.isPending} onClick={handleUnlink}>
                  {t('telegramSupervisorUnlink')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <>
            {generatedCode && (
              <div className="rounded-md border bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">{t('telegramSupervisorCodeLabel')}</p>
                <p className="font-mono text-2xl font-semibold tracking-widest">{generatedCode.code}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('telegramSupervisorCodeExpiresAt', { time: new Date(generatedCode.expiresAt).toLocaleTimeString() })}
                </p>
              </div>
            )}
            <Button size="sm" loading={generateCode.isPending} onClick={handleGenerate}>
              {t('telegramSupervisorGenerateCode')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
