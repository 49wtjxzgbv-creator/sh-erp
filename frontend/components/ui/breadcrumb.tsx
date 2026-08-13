import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Plain (no Radix — breadcrumbs are just links, no interactive behavior to
 * manage) trail for the Topbar's breadcrumb slot. A page opts in by passing
 * its own trail; not every page needs one (see components/domain/shell/topbar.tsx).
 */
const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'nav'>>(
  ({ className, ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" className={className} {...props} />,
);
Breadcrumb.displayName = 'Breadcrumb';

const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<'ol'>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn('flex flex-wrap items-center gap-1 text-sm text-muted-foreground', className)} {...props} />
  ),
);
BreadcrumbList.displayName = 'BreadcrumbList';

const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('flex items-center gap-1', className)} {...props} />,
);
BreadcrumbItem.displayName = 'BreadcrumbItem';

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<typeof Link>>(
  ({ className, ...props }, ref) => (
    <Link ref={ref} className={cn('transition-colors hover:text-foreground', className)} {...props} />
  ),
);
BreadcrumbLink.displayName = 'BreadcrumbLink';

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} aria-current="page" className={cn('font-medium text-foreground', className)} {...props} />
  ),
);
BreadcrumbPage.displayName = 'BreadcrumbPage';

function BreadcrumbSeparator({ className, ...props }: React.ComponentPropsWithoutRef<'li'>) {
  return (
    <li role="presentation" aria-hidden="true" className={cn('[&>svg]:h-3.5 [&>svg]:w-3.5', className)} {...props}>
      <ChevronRight />
    </li>
  );
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator };
