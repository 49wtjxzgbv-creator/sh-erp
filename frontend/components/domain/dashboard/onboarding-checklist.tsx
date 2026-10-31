'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Rocket, X } from 'lucide-react';
import { useOnboardingProgress } from '@/lib/hooks/use-dashboard';
import type { OnboardingProgress } from '@/lib/api-client/dashboard';
import { useTraining } from '@/components/domain/training/training-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'sh-erp-onboarding-dismissed';

interface OnboardingStepDef {
  key: keyof OnboardingProgress;
  titleKey: string;
  descKey: string;
  href: string;
  courseId?: string;
}

/**
 * Ordered to match this company's real make-to-order flow (same sequence
 * the "16 — Повний цикл" training course teaches): master data first
 * (catalog/BOM/suppliers), then the order-driven operational cycle
 * (order → procure → receive → produce → ship). Not a hard gate — every
 * step links out immediately regardless of what's done above it — just a
 * recommended starting order for a company with zero data.
 */
const STEPS: OnboardingStepDef[] = [
  { key: 'hasProducts', titleKey: 'stepCatalog', descKey: 'stepCatalogDesc', href: '/catalog/new', courseId: 'catalog' },
  { key: 'hasAssemblies', titleKey: 'stepBom', descKey: 'stepBomDesc', href: '/bom/new', courseId: 'bom' },
  { key: 'hasSuppliers', titleKey: 'stepSuppliers', descKey: 'stepSuppliersDesc', href: '/procurement/suppliers' },
  { key: 'hasCustomerOrders', titleKey: 'stepSalesOrder', descKey: 'stepSalesOrderDesc', href: '/sales/new', courseId: 'sales-order' },
  { key: 'hasPurchaseOrders', titleKey: 'stepProcurement', descKey: 'stepProcurementDesc', href: '/procurement/new', courseId: 'procurement' },
  { key: 'hasReceivedStock', titleKey: 'stepReceiving', descKey: 'stepReceivingDesc', href: '/procurement', courseId: 'receiving' },
  { key: 'hasProductionOrders', titleKey: 'stepProduction', descKey: 'stepProductionDesc', href: '/production', courseId: 'give-to-production' },
  { key: 'hasFinishedGoods', titleKey: 'stepFinishedGoods', descKey: 'stepFinishedGoodsDesc', href: '/production/finished-goods', courseId: 'finished-goods' },
  { key: 'hasShipments', titleKey: 'stepShipments', descKey: 'stepShipmentsDesc', href: '/sales/shipments', courseId: 'shipments' },
  { key: 'hasEmployees', titleKey: 'stepEmployees', descKey: 'stepEmployeesDesc', href: '/hr/new', courseId: 'hr' },
];

/**
 * Dashboard-level getting-started checklist, visible by default (unlike the
 * opt-in Training Center) so a brand-new company sees "what to do first"
 * the moment it lands on /dashboard. Progress is real data, not a tour
 * script — each row reflects GET /dashboard/onboarding-progress, so it
 * stays accurate even for a company that set itself up without ever
 * opening Training Center. Dismiss state is per-browser localStorage,
 * same convention as TrainingWelcomeBanner/TrainingProvider.
 */
export function OnboardingChecklist() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const { data, isLoading } = useOnboardingProgress();
  const { startCourse } = useTraining();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      // Private-browsing/quota-exceeded edge case — just show the checklist.
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Non-fatal — checklist may reappear next visit, acceptable.
    }
  }

  if (dismissed || isLoading || !data) return null;

  const done = STEPS.filter((step) => data[step.key]).length;
  const total = STEPS.length;

  if (done === total) {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">{t('allDoneTitle')}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={dismiss} aria-label={t('dismiss')}>
            <X className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-tour="onboarding-checklist" className="border-primary/40 bg-primary/5">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle', { done, total })}</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label={t('dismiss')}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {STEPS.map((step, index) => {
          const stepDone = Boolean(data[step.key]);
          return (
            <div
              key={step.key}
              className={cn('flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors', !stepDone && 'hover:bg-background/60')}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                    stepDone ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-muted-foreground',
                  )}
                >
                  {stepDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div>
                  <p className={cn('text-sm font-medium', stepDone && 'text-muted-foreground line-through')}>{t(step.titleKey)}</p>
                  {!stepDone && <p className="text-xs text-muted-foreground">{t(step.descKey)}</p>}
                </div>
              </div>
              {!stepDone && (
                <div className="flex shrink-0 items-center gap-1">
                  {step.courseId && (
                    <Button variant="ghost" size="sm" onClick={() => startCourse(step.courseId!, 0)}>
                      {t('learnHow')}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => router.push(step.href)}>
                    {t('go')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
