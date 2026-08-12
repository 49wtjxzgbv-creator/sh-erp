#!/usr/bin/env node
// The STEP 3D viewer (components/domain/files/step-3d-viewer.tsx) loads
// occt-import-js's WASM module client-side, and points it at this file via
// `locateFile: () => '/occt/occt-import-js.wasm'`. Emscripten's glue JS
// fetches that path directly (not through webpack/Next's module graph), so
// the .wasm binary has to exist as a literal static file under `public/` —
// same "physically copy it, don't rely on the bundler to find it" situation
// scripts/copy-standalone-static.js already documents for a different pair
// of directories. Runs as `postinstall` (not `postbuild`) so it's also
// present for `next dev`, not just production builds.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'occt-import-js', 'dist', 'occt-import-js.wasm');
const destDir = path.join(root, 'public', 'occt');
const dest = path.join(destDir, 'occt-import-js.wasm');

if (!fs.existsSync(src)) {
  console.log('postinstall: occt-import-js not installed, skipping wasm copy.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`postinstall: copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
