import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Продукт',
    links: [
      { label: 'Модулі', href: '#modules' },
      { label: 'Тарифи', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    title: 'Компанія',
    links: [
      { label: 'Контакти', href: '#contact' },
      { label: 'Увійти', href: '/login' },
      { label: 'Реєстрація', href: '/register' },
    ],
  },
];

export function MarketingFooter({ tagline }: { tagline: string }) {
  return (
    <footer className="border-t border-border py-12">
      <div className="container">
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs">
                S
              </span>
              SH ERP
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">{tagline}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:gap-16">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold">{col.title}</h3>
                <ul className="mt-3 space-y-2">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Shyring. Усі права захищено.</p>
          <p>SH ERP by Shyring</p>
        </div>
      </div>
    </footer>
  );
}
