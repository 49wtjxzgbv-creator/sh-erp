#!/usr/bin/env node
// Real, recurring production bug (found during the 2026-08-05 audit): with
// `output: 'standalone'` (next.config.mjs), Next.js traces the actual
// runtime dependency graph into `.next/standalone/` but deliberately does
// NOT copy `.next/static/` or `public/` into it — this is documented
// upstream Next.js behavior, not a bug in Next itself, but it means every
// `npm run build` produces a `.next/standalone/server.js` that 404s on
// every `/_next/static/...` asset and every file under `public/` (the
// site's own background image, favicon, etc.) until someone copies those
// two directories in by hand. That manual step is exactly what kept
// getting forgotten after a deploy, causing "CSS не віддавався" / "фон не
// відображався" in production.
//
// This script is npm's own `postbuild` lifecycle hook (see package.json) —
// it runs automatically, every time, as an inseparable part of
// `npm run build` itself. There is no longer a "remember to copy static"
// step for anyone to forget: if `npm run build` succeeded, the standalone
// server is already complete and ready to run.
//
// Plain Node (fs.cpSync, Node 16.7+) rather than a shell `cp -r` — this
// runs identically on the CI runner, a contributor's machine, and the VPS,
// with no dependency on which shell happens to be invoking npm.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const standaloneDir = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  console.error(
    'postbuild: .next/standalone does not exist — is `output: "standalone"` still set in next.config.mjs? Nothing to copy into, aborting.',
  );
  process.exit(1);
}

const copies = [
  { from: path.join(root, '.next', 'static'), to: path.join(standaloneDir, '.next', 'static') },
  { from: path.join(root, 'public'), to: path.join(standaloneDir, 'public') },
];

for (const { from, to } of copies) {
  if (!fs.existsSync(from)) {
    console.log(`postbuild: ${path.relative(root, from)} does not exist, skipping (nothing to copy).`);
    continue;
  }
  fs.cpSync(from, to, { recursive: true, force: true });
  console.log(`postbuild: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

console.log('postbuild: standalone build is complete and self-contained — ready to run with `node server.js`.');
