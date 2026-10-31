import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';

/**
 * `@google/model-viewer` ships its own `ModelViewerElement` class/types but
 * no React JSX typing for the `<model-viewer>` custom element — this is
 * `ar-view-button.tsx`'s only use of the tag, so only the attributes it
 * actually sets are declared (plus `src`/`alt`, the two any usage needs).
 */
// React 19 moved the JSX namespace from the bare global `JSX` to
// `React.JSX` (@types/react's index.d.ts nests it inside `declare namespace
// React`) — augmenting via `declare module 'react'` is the pattern React's
// own types use internally and merges correctly into React.JSX, unlike the
// old `declare global { namespace JSX {...} }` form, which no longer has
// anything to merge with.
declare module 'react' {
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
