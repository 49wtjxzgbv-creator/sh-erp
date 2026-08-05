import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            S
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">SH ERP</h1>
          <p className="text-sm text-muted-foreground">by Shyring</p>
        </Link>
        {children}
      </div>
    </div>
  );
}
