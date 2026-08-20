import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';

export function ShowcaseStep({
  index,
  title,
  description,
  imageUrl,
  reverse,
}: {
  index: number;
  title: string;
  description: string;
  imageUrl: string | null;
  reverse: boolean;
}) {
  return (
    <Reveal className={cn('grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20', reverse && 'lg:[direction:rtl]')}>
      <div className={cn(reverse && 'lg:[direction:ltr]')}>
        <span className="text-sm font-semibold tracking-wide text-primary">{String(index).padStart(2, '0')}</span>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h3>
        <p className="mt-3.5 max-w-md text-balance leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/[0.06]', reverse && 'lg:[direction:ltr]')}>
        {imageUrl ? (
          <Image src={imageUrl} alt={title} width={1200} height={750} className="h-auto w-full" loading="lazy" />
        ) : (
          // Honest placeholder, not a fabricated screenshot — real screenshots
          // are a separate, disclosed follow-up (Phase 3 of the
          // implementation plan) captured from actual product UI.
          <div className="flex aspect-[16/10] items-center justify-center bg-secondary/30 text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </div>
    </Reveal>
  );
}
