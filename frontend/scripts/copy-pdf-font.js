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
// `roboto-fontface` ships one non-subsetted .woff per weight (unlike
// @fontsource's per-unicode-range-subsetted files, which would need
// stitching multiple fonts together for one drawText call) — Roboto
// Regular alone covers Latin + Cyrillic, which is all this feature needs.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'roboto-fontface', 'fonts', 'roboto', 'Roboto-Regular.woff');
const destDir = path.join(root, 'public', 'fonts');
const dest = path.join(destDir, 'pdf-editor-cyrillic.woff');

if (!fs.existsSync(src)) {
  console.log('postinstall: roboto-fontface not installed, skipping font copy.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`postinstall: copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
