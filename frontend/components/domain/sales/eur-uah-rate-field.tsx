'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Small "Курс EUR → UAH" input, shared look for every payroll print toolbar that needs one (see useEurUahRate's own header comment). Never rendered inside a `<PrintArea>` — this is a pre-print control, not part of the document. */
export function EurUahRateField({ rate, onChange }: { rate: number | null; onChange: (next: number | null) => void }) {
  const t = useTranslations('sales');

  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor="eur-uah-rate" className="whitespace-nowrap text-xs text-muted-foreground">
        {t('eurUahRateLabel')}
      </Label>
      <Input
        id="eur-uah-rate"
        type="number"
        step="any"
        min={0}
        className="h-8 w-24"
        value={rate ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          onChange(value ? Number(value) : null);
        }}
      />
    </div>
  );
}
