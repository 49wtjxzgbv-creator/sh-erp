import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/domain/shell/logo';

/** Nav labels are static UI chrome translated via next-intl's `marketing` namespace — same scoping note as marketing-header.tsx. `pricingVisible` hides the "Pricing" link when that section is hidden (see page.tsx). */
export function MarketingFooter({ tagline, pricingVisible = true }: { tagline: string; pricingVisible?: boolean }) {
  const t = useTranslations('marketing');

  const columns = [
    {
      title: t('footerProductColumn'),
      links: [
        { label: t('navModules'), href: '#modules' },
        ...(pricingVisible ? [{ label: t('navPricing'), href: '#pricing' }] : []),
        { label: t('navFaq'), href: '#faq' },
      ],
    },
    {
      title: t('footerCompanyColumn'),
      links: [
        { label: t('navContact'), href: '#contact' },
        { label: t('login'), href: '/login' },
        { label: t('footerRegister'), href: '/register' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border py-16">
      <div className="container">
        <div className="flex flex-col justify-between gap-12 sm:flex-row">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Logo size={24} />
              SH ERP
            </Link>
            <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">{tagline}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:gap-20">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold">{col.title}</h3>
                <ul className="mt-3.5 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-7 text-xs text-muted-foreground sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Shyring. {t('footerRights')}.</p>
          <p>SH ERP by Shyryng</p>
        </div>
      </div>
    </footer>
  );
}
