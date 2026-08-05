'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePlans, useSubscription, useUpdateSubscription } from '@/lib/hooks/use-billing';
import type { PlanKey } from '@/lib/api-client/billing';
import { toNumber } from '@/lib/api-client/decimal';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LoadingBlock } from '@/components/ui/loading-block';

/**
 * Phase 0 billing stub (billing.service.ts's own header comment): switching
 * plans here records the change immediately — no payment is collected, no
 * Stripe checkout redirect exists. `GET /billing/plans` is ungated (every
 * authenticated role can see pricing); the subscription read/write requires
 * `company:billing`, enforced server-side only.
 */
export default function BillingPage() {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const { data: plans, isLoading: plansLoading } = usePlans();
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription();
  const updateSubscription = useUpdateSubscription();

  const [error, setError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<PlanKey | null>(null);

  async function handleSwitch(planKey: PlanKey) {
    setError(null);
    setSwitchingTo(planKey);
    try {
      await updateSubscription.mutateAsync(planKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    } finally {
      setSwitchingTo(null);
    }
  }

  const isLoading = plansLoading || subscriptionLoading;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          {subscription && (
            <Card>
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t('currentPlan')}</p>
                  <p className="text-lg font-semibold">{subscription.plan.name}</p>
                </div>
                <Badge variant={subscription.status === 'ACTIVE' ? 'success' : subscription.status === 'PAST_DUE' ? 'destructive' : 'secondary'}>
                  {t(`status.${subscription.status}`)}
                </Badge>
              </CardContent>
            </Card>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            {plans?.map((plan) => {
              const current = subscription?.planId === plan.id;
              return (
                <Card key={plan.id} className={cn(current && 'border-primary')}>
                  <CardHeader>
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    <CardDescription>
                      {toNumber(plan.monthlyPriceEur) === 0 ? t('free') : `€${toNumber(plan.monthlyPriceEur)} / ${t('perMonth')}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {Object.entries(plan.limits).map(([key, value]) => (
                        <li key={key}>
                          {key}: {String(value)}
                        </li>
                      ))}
                    </ul>
                    {current ? (
                      <Badge variant="outline">{t('currentPlanBadge')}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSwitch(plan.key as PlanKey)}
                        loading={switchingTo === plan.key}
                        disabled={updateSubscription.isPending}
                      >
                        {t('switchTo')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
