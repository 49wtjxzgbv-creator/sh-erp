'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLowStockDigestPreview, useSendLowStockDigestNow } from '@/lib/hooks/use-notifications';
import { useCompanySettings } from '@/lib/hooks/use-settings';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';

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
      setError(err instanceof ApiError ? err.message : tc('error'));
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
    </div>
  );
}
