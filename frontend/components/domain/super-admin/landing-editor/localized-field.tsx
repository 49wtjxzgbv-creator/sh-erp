import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Locale } from '@/lib/i18n-locales';
import type { LocalizedText } from '@/lib/landing-page/types';

interface Props {
  label: string;
  value: LocalizedText;
  locale: Locale;
  onChange: (next: LocalizedText) => void;
}

/** Bound to whichever locale the page-level LocaleSwitcher currently has selected — see that component's own header comment. */
export function LocalizedTextField({ label, value, locale, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-300">{label}</Label>
      <Input
        value={value[locale]}
        onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
        className="border-slate-700 bg-slate-800 text-slate-100"
      />
    </div>
  );
}

export function LocalizedTextareaField({ label, value, locale, onChange, rows = 3 }: Props & { rows?: number }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-300">{label}</Label>
      <Textarea
        rows={rows}
        value={value[locale]}
        onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
        className="border-slate-700 bg-slate-800 text-slate-100"
      />
    </div>
  );
}
