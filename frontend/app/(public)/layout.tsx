import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';
import { Logo } from '@/components/domain/shell/logo';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">SH ERP</h1>
          <p className="text-sm text-muted-foreground">by Shyryng</p>
        </Link>
        {children}
      </div>
    </div>
  );
}
