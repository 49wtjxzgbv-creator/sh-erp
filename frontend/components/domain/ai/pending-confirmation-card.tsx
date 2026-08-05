'use client';

import { useTranslations } from 'next-intl';
import type { PendingConfirmation } from '@/lib/api-client/ai';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Renders a `PendingConfirmation` returned by `askFullAssistant` when the
 * model proposed a `critical`-flagged tool call (only `adjustProductStock`
 * exists today, per `adjust-stock.tool.ts`). The action is NEVER executed
 * until the user explicitly clicks Confirm here — `AiToolsRegistry` already
 * short-circuited the real mutation server-side, this card is the only way
 * to actually reach `AiActionsService.confirmAction`.
 */
export interface PendingConfirmationCardProps {
  pending: PendingConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
  cancelling?: boolean;
}

export function PendingConfirmationCard({ pending, onConfirm, onCancel, confirming, cancelling }: PendingConfirmationCardProps) {
  const t = useTranslations('ai');

  return (
    <Card className="border-warning">
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center gap-2">
          <Badge variant="warning">{t('confirmationNeeded')}</Badge>
          <span className="text-xs text-muted-foreground">{pending.action}</span>
        </div>
        <p className="text-sm">{pending.description}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={onConfirm} loading={confirming}>
            {t('confirmAction')}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel} loading={cancelling}>
            {t('cancelAction')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
