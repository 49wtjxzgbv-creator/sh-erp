'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '#modules', label: 'Модулі' },
  { href: '#product', label: 'Продукт' },
  { href: '#pricing', label: 'Тарифи' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'Контакти' },
];

/**
 * Sticky marketing header, shown only on "/" (the Landing Page) — the
 * authenticated app has its own Topbar (components/domain/shell/topbar.tsx),
 * deliberately not shared with this one since the two audiences and nav
 * needs are completely different.
 */
export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b transition-colors',
        scrolled ? 'border-border bg-background/80 backdrop-blur-md' : 'border-transparent bg-transparent',
      )}
    >
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
              <path
                d="M7 15.5c0 1.5 1.3 2.6 3.4 2.6h.8c1.8 0 3-1 3-2.4 0-1.6-1.4-2.1-3.2-2.5l-.8-.2c-1.8-.4-4-1.2-4-3.4C6.2 7.5 8.1 6 11 6c2.6 0 4.3 1.3 4.4 3.4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          SH ERP
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          {/* Plain Link + buttonVariants(), not Button asChild — see hero.tsx's comment for why. */}
          <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
            Увійти
          </Link>
          <Link href="/register" className={buttonVariants({})}>
            Почати безкоштовно
          </Link>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <LanguageSwitcher />
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="container flex flex-col gap-1 py-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 px-2">
              <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
                Увійти
              </Link>
              <Link href="/register" className={buttonVariants({})}>
                Почати безкоштовно
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
