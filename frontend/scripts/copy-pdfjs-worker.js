#!/usr/bin/env node
// The PDF editor/viewer (components/domain/pdf/, app/(app)/pdf/[id]/page.tsx)
// loads pdfjs-dist's rendering worker client-side via
// `GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'`, and points
// `getDocument()` at `standardFontDataUrl`/`cMapUrl` so it can extract text
// (`getTextContent()`, which the "Редагувати" tool's hit-testing depends on
// entirely) from PDFs that reference a non-embedded standard font or a
// non-Latin encoding — without these, pdfjs silently returns an EMPTY text
// layer for such a page rather than throwing, which read as "click does
// nothing" during testing (a plain pdf-lib-generated PDF using
// StandardFonts.Helvetica, i.e. not embedding the font at all, was the
// reproduction case). All three are fetched by the browser as literal URLs
// (not through webpack/Next's module graph), so they have to exist as
// physical static files under `public/` — same situation
// scripts/copy-occt-wasm.js already documents for a different asset. Runs as
// `postinstall` (not `postbuild`) so they're also present for `next dev`,
// not just production builds.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkgRoot = path.join(root, 'node_modules', 'pdfjs-dist');
const destDir = path.join(root, 'public', 'pdfjs');

if (!fs.existsSync(pkgRoot)) {
  console.log('postinstall: pdfjs-dist not installed, skipping asset copy.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

const file = { from: path.join(pkgRoot, 'build', 'pdf.worker.min.mjs'), to: path.join(destDir, 'pdf.worker.min.mjs') };
fs.copyFileSync(file.from, file.to);
console.log(`postinstall: copied ${path.relative(root, file.from)} -> ${path.relative(root, file.to)}`);

for (const dirName of ['standard_fonts', 'cmaps']) {
  const from = path.join(pkgRoot, dirName);
  const to = path.join(destDir, dirName);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`postinstall: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
