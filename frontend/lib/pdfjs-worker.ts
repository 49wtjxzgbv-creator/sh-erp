import { GlobalWorkerOptions } from 'pdfjs-dist';

/**
 * Side-effect import, once, before the first `getDocument()` call. The
 * worker file is fetched by the browser as a literal static URL (not
 * through webpack's module graph), so it's copied into `public/pdfjs/` by
 * `scripts/copy-pdfjs-worker.js` (postinstall) — see that script's own
 * comment, and its `occt-import-js` precedent.
 */
GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
