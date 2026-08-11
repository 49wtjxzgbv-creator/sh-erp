'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { locales, LOCALE_COOKIE_NAME, type Locale } from '@/lib/i18n-locales';

const LOCALE_LABELS: Record<Locale, string> = {
  uk: 'Українська',
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
};

/**
 * next-intl here resolves locale from a plain cookie, not the URL (see
 * i18n.ts's own header comment) — switching just sets that cookie and asks
 * the router to refresh, which re-runs the server-rendered layout tree
 * (root layout reads the cookie via getRequestConfig) with the new locale's
 * messages. Reused identically on the authenticated app's Topbar, the
 * (public) auth pages, the marketing Landing Page header, and Super Admin.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          disabled={pending}
          aria-label="Change language"
          title={LOCALE_LABELS[locale]}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLocale(l)} className={l === locale ? 'font-semibold' : undefined}>
            {LOCALE_LABELS[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
