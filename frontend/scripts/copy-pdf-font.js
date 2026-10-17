#!/usr/bin/env node
// The PDF editor's "Текст"/"Редагувати" tools (components/domain/pdf/,
// app/(app)/pdf/[id]/page.tsx) draw user-typed text into the exported PDF
// via pdf-lib. pdf-lib's built-in StandardFonts (Helvetica etc.) use WinAnsi
// encoding, which cannot represent Cyrillic at all — `drawText` throws
// ("WinAnsi cannot encode...") the moment a user (this app's primary
// audience) types so much as one Ukrainian/Russian letter. Embedding a real
// font via pdf-lib's fontkit integration fixes this, but needs an actual
// font FILE with Cyrillic coverage fetched client-side at export time — same
// "physically copy it into public/, don't rely on the bundler to find it"
// situation scripts/copy-occt-wasm.js and scripts/copy-pdfjs-worker.js
// already document for other binary assets.
//
// `roboto-fontface` ships one non-subsetted .woff per weight/family (unlike
// @fontsource's per-unicode-range-subsetted files, which would need
// stitching multiple fonts together for one drawText call) — each Regular
// weight alone covers Latin + Cyrillic. Two families (sans/serif) are copied
// so the "Текст"/"Редагувати" tools can offer a real font choice, not just
// one typeface.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const destDir = path.join(root, 'public', 'fonts');

const files = [
  { src: ['node_modules', 'roboto-fontface', 'fonts', 'roboto', 'Roboto-Regular.woff'], dest: 'pdf-editor-sans.woff' },
  { src: ['node_modules', 'roboto-fontface', 'fonts', 'roboto-slab', 'Roboto-Slab-Regular.woff'], dest: 'pdf-editor-serif.woff' },
];

fs.mkdirSync(destDir, { recursive: true });

for (const { src, dest } of files) {
  const srcPath = path.join(root, ...src);
  const destPath = path.join(destDir, dest);
  if (!fs.existsSync(srcPath)) {
    console.log(`postinstall: ${path.join(...src)} not found (roboto-fontface not installed?), skipping.`);
    continue;
  }
  fs.copyFileSync(srcPath, destPath);
  console.log(`postinstall: copied ${path.relative(root, srcPath)} -> ${path.relative(root, destPath)}`);
}
