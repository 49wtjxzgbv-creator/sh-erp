import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';

/**
 * `@google/model-viewer` ships its own `ModelViewerElement` class/types but
 * no React JSX typing for the `<model-viewer>` custom element — this is
 * `ar-view-button.tsx`'s only use of the tag, so only the attributes it
 * actually sets are declared (plus `src`/`alt`, the two any usage needs).
 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
        src?: string;
        alt?: string;
        ar?: boolean | '';
        'ar-modes'?: string;
        'ar-scale'?: string;
        'ar-placement'?: string;
        'ios-src'?: string;
      };
    }
  }
}
