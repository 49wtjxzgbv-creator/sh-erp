import { cn } from '@/lib/utils';

/** Standard shadcn-style pulse skeleton — the shared building block for every loading state in this app (DataTable rows, detail-page loaders, etc.), replacing plain "Завантаження..." text. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
