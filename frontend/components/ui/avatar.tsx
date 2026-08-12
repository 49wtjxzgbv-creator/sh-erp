import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ImageOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PhotoLightbox } from './photo-lightbox';

/**
 * Square photo slot with a fallback icon — the shared building block for
 * every product/assembly/employee photo thumbnail in this app (list
 * columns, form previews). Deliberately square/rounded-md rather than
 * circular (`rounded-full`): these represent physical items, not people,
 * so a product-photo convention reads better than a user-avatar one.
 */
const avatarVariants = cva('relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted', {
  variants: {
    size: {
      sm: 'h-8 w-8',
      md: 'h-10 w-10',
      lg: 'h-16 w-16',
      xl: 'h-32 w-32',
      '2xl': 'h-48 w-48',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof avatarVariants> {
  src?: string | null;
  alt?: string;
  /** Shown when `src` is empty, or after the image fails to load. Defaults to a broken-image icon. */
  fallbackIcon?: LucideIcon;
  /**
   * Clicking a loaded image opens it full-size in a `PhotoLightbox`. Defaults
   * to `true` so every existing usage across the app (list thumbnails, detail
   * pages, print views) gets "tap to enlarge" for free. Set to `false` only
   * where the thumbnail is already the click target for something else —
   * `FileUploadField`/`PendingPhotoField` wrap it in their own "click to
   * choose a file" button, and a nested zoom handler would swallow that click.
   */
  zoomable?: boolean;
}

function Avatar({ src, alt = '', fallbackIcon: FallbackIcon = ImageOff, size, className, zoomable = true, ...props }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const showImage = Boolean(src) && !failed;
  const canZoom = showImage && zoomable;

  return (
    <div
      className={cn(avatarVariants({ size }), canZoom && 'cursor-zoom-in', className)}
      onClick={
        canZoom
          ? (e) => {
              e.stopPropagation();
              setZoomed(true);
            }
          : undefined
      }
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- R2 presigned URLs are short-lived and cross-origin; next/image's remote-pattern allowlist doesn't fit a per-request signed URL.
        <img src={src as string} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <FallbackIcon className="h-1/3 w-1/3 text-muted-foreground" aria-hidden="true" />
      )}
      {zoomed && canZoom && <PhotoLightbox src={src as string} alt={alt} onClose={() => setZoomed(false)} />}
    </div>
  );
}

export { Avatar, avatarVariants };
