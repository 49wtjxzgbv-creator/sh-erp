'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useExchangeRates, useSetExchangeRateOverride, useSyncExchangeRates } from '@/lib/hooks/use-finance';
import type { Currency } from '@/lib/api-client/finance';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { RequirePermission } from '@/components/domain/auth/require-permission';

const CURRENCIES: Currency[] = ['EUR', 'USD'];

/**
 * Multi-currency module (2026-10-29) — replaces the localStorage-only
 * `useEurUahRate` hack (see use-eur-uah-rate.ts's own removal note) with a
 * real, persisted, historical rate: NBU's daily official rate, synced
 * automatically, plus a per-date manual override that always wins when
 * present. Every print/report that needs EUR<->UAH now reads from here
 * instead of asking the user to retype a number each time.
 */
function ExchangeRatesPageInner() {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: rates, isLoading } = useExchangeRates();
  const setOverride = useSetExchangeRateOverride();
  const sync = useSyncExchangeRates();

  const [currency, setCurrency] = useState<Currency>('EUR');
  const [rate, setRate] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSetOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!rate) return;
    setFormError(null);
    try {
      await setOverride.mutateAsync({ currency, rate: Number(rate), asOfDate });
      setRate('');
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleSync() {
    setSyncError(null);
    try {
      await sync.mutateAsync(undefined);
    } catch (err) {
      setSyncError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('exchangeRatesTitle')}</h1>
        <Button type="button" variant="outline" loading={sync.isPending} onClick={handleSync}>
          {t('exchangeRatesSyncNow')}
        </Button>
      </div>
      {syncError && <p className="text-sm text-destructive">{syncError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('exchangeRatesAddOverride')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleSetOverride}>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">{t('exchangeRatesCurrency')}</label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="exchangeRateDate">
                {t('exchangeRatesDate')}
              </label>
              <Input id="exchangeRateDate" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="exchangeRateValue">
                {t('exchangeRatesRateToUah')}
              </label>
              <Input
                id="exchangeRateValue"
                type="number"
                step="any"
                min="0"
                className="w-32"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <Button type="submit" loading={setOverride.isPending}>
              {tc('save')}
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
          <p className="mt-2 text-xs text-muted-foreground">{t('exchangeRatesOverrideHint')}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('exchangeRatesDate')}</TableHead>
              <TableHead>{t('exchangeRatesCurrency')}</TableHead>
              <TableHead>{t('exchangeRatesRateToUah')}</TableHead>
              <TableHead>{t('exchangeRatesSource')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rates ?? []).map((r, i) => (
              <TableRow key={`${r.currency}-${r.asOfDate}-${i}`}>
                <TableCell>{new Date(r.asOfDate).toLocaleDateString()}</TableCell>
                <TableCell>{r.currency}</TableCell>
                <TableCell>{r.rate.toFixed(4)}</TableCell>
                <TableCell>
                  <Badge variant={r.source === 'MANUAL' ? 'warning' : 'secondary'}>
                    {r.source === 'MANUAL' ? t('exchangeRatesSourceManual') : t('exchangeRatesSourceNbu')}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {(rates ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t('exchangeRatesEmpty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function ExchangeRatesPage() {
  return (
    <RequirePermission permission="finance:manage" redirectTo="/finance">
      <ExchangeRatesPageInner />
    </RequirePermission>
  );
}
