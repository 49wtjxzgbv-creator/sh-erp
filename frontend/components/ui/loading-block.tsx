import { Skeleton } from '@/components/ui/skeleton';

/**
 * Drop-in replacement for the old `<p className="text-sm text-muted-foreground">{tc('loading')}</p>`
 * pattern that used to be hand-repeated across every detail page's initial
 * `isLoading` guard. A skeleton silhouette reads as "this page is loading
 * its layout" rather than a bare sentence — same purpose, more polished,
 * and now defined once instead of copy-pasted per page.
 */
export function LoadingBlock({ className }: { className?: string }) {
  return (
    <div className={className ?? 'space-y-4'}>
      <Skeleton className="h-7 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
