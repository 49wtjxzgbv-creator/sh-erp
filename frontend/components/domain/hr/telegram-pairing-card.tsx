'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGenerateTelegramPairingCode, useUnlinkTelegram } from '@/lib/hooks/use-hr';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { Employee } from '@/lib/api-client/hr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
 * "Бот через який працівники зможуть подавати виконану роботу" (2026-10-01
 * user request) — the HR-side half of the pairing flow. Generates a
 * one-time code (EmployeesService#generateTelegramPairingCode) the
 * employee sends to the shared platform bot as `/start <code>`; the bot
 * itself (TelegramBotService#completePairing) clears the code and sets
 * `telegramChatId` once that happens — this card just shows whichever
 * state the Employee row is currently in, no polling (the HR person simply
 * refreshes or navigates back after handing the code to the employee).
 */
export function TelegramPairingCard({ employee }: { employee: Employee }) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const generateCode = useGenerateTelegramPairingCode(employee.id);
  const unlinkTelegram = useUnlinkTelegram(employee.id);
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

  const isPaired = Boolean(employee.telegramChatId);
  const isPending = !isPaired && Boolean(employee.telegramPairingCode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('telegramBot')}
          {isPaired ? (
            <Badge variant="success">{t('telegramPaired')}</Badge>
          ) : isPending ? (
            <Badge variant="warning">{t('telegramPairingPending')}</Badge>
          ) : (
            <Badge variant="secondary">{t('telegramNotPaired')}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {isPaired ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('telegramLinkedAt', { date: employee.telegramLinkedAt ? new Date(employee.telegramLinkedAt).toLocaleString() : '—' })}
            </p>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {t('telegramUnlink')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('telegramUnlinkConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('telegramUnlinkConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={unlinkTelegram.isPending} onClick={handleUnlink}>
                    {t('telegramUnlink')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('telegramDescription')}</p>
            {generatedCode && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t('telegramPairingCodeLabel')}</p>
                <p className="font-mono text-2xl font-semibold tracking-widest">{generatedCode.code}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('telegramPairingCodeExpiresAt', { time: new Date(generatedCode.expiresAt).toLocaleTimeString() })}
                </p>
              </div>
            )}
            <Button size="sm" loading={generateCode.isPending} onClick={handleGenerate}>
              {t('telegramGenerateCode')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
