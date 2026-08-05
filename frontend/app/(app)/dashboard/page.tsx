'use client';

import { useTranslations } from 'next-intl';
import { useSessionStore } from '@/lib/auth/session-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Minimal landing page for now — deliberately not fetching or fabricating
 * business metrics here. A real metrics dashboard belongs to the Reports
 * module task (frontend Task 50), once reorder-suggestions/valuation/
 * production-rollup views exist to pull real cards from; this page will
 * grow into that dashboard rather than being replaced by it.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tn = useTranslations('nav');
  const companySlug = useSessionStore((s) => s.companySlug);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {t('welcome')}
          {companySlug ? `, ${companySlug}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{t('overview')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(['catalog', 'inventory', 'production', 'sales', 'procurement', 'reports'] as const).map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{tn(key)}</CardTitle>
              <CardDescription>—</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </div>
  );
}
