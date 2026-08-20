import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Locale } from '@/lib/i18n-locales';

const LOCALE_LABELS: Record<Locale, string> = { uk: 'Українська', en: 'English', pl: 'Polski', de: 'Deutsch' };

/**
 * One page-level locale switcher, not a tab bar repeated on every field —
 * every field below reads/writes whichever locale is currently selected
 * here. Far more usable for translating dozens of fields than a 4-tab
 * switcher duplicated per field would be, and still lets the Super Admin
 * edit content in all 4 locales as required.
 */
export function LocaleSwitcher({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return (
    <Tabs value={locale} onValueChange={(v) => onChange(v as Locale)}>
      <TabsList>
        {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
          <TabsTrigger key={l} value={l}>
            {LOCALE_LABELS[l]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
