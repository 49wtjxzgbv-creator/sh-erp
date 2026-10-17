#!/usr/bin/env node
// The PDF editor/viewer (components/domain/pdf/, app/(app)/pdf/[id]/page.tsx)
// loads pdfjs-dist's rendering worker client-side via
// `GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'`. The worker is
// fetched by the browser directly as a literal URL, not through webpack/
// Next's module graph, so it has to exist as a physical static file under
// `public/` — same situation scripts/copy-occt-wasm.js already documents for
// a different asset. Runs as `postinstall` (not `postbuild`) so it's also
// present for `next dev`, not just production builds.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const destDir = path.join(root, 'public', 'pdfjs');
const dest = path.join(destDir, 'pdf.worker.min.mjs');

if (!fs.existsSync(src)) {
  console.log('postinstall: pdfjs-dist not installed, skipping worker copy.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`postinstall: copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
