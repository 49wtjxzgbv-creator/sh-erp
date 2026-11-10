import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';

/**
 * `@google/model-viewer` ships its own `ModelViewerElement` class/types but
 * no React JSX typing for the `<model-viewer>` custom element — only the
 * attributes actual usages set are declared (plus `src`/`alt`, every usage
 * needs those). `ar-view-button.tsx` only needs the `ar-*` ones (it keeps
 * the element invisible, purely for the AR handoff); `model-3d-viewer.tsx`
 * (2026-11-10, sourcing bot Mini App — "і 3д") added the visible-viewer
 * attributes below for an actual on-screen orbit/zoom view.
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
        'camera-controls'?: boolean | '';
        'auto-rotate'?: boolean | '';
        'disable-zoom'?: boolean | '';
        'shadow-intensity'?: string;
        exposure?: string;
        'interaction-prompt'?: string;
      };
    }
  }
}
