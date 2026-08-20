import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `output: 'standalone'` added for the Hostinger VPS deployment path
  // (docs/deployment.md) — added during production-readiness pass, real
  // infra necessity, not a new app feature. Next.js's default build output
  // needs the full `node_modules` tree present at runtime; `standalone`
  // instead traces the actual runtime dependency graph into
  // `.next/standalone/` (a minimal, self-contained `node_modules` + a
  // generated `server.js`), which is what `frontend/Dockerfile`'s runtime
  // stage copies — without this, that image would either need to ship the
  // entire dev-plus-prod `node_modules` (much larger, slower cold starts)
  // or a hand-rolled dependency-pruning step. Has no effect on the
  // Vercel-native deployment path (Vercel does its own equivalent tracing
  // regardless of this setting) — safe to enable unconditionally.
  output: 'standalone',
  // Real, repeatedly-reproduced flakiness on the production VPS
  // (2026-08-19, hit on several separate deploys): `next build`'s
  // static-page generation intermittently throws "Cannot read properties
  // of null (reading 'useContext')" on nearly every page — never
  // reproduced locally, and a plain retry with a clean .next eventually
  // succeeds every time (see ops/deploy.sh's own retry loop — the actual
  // mitigation keeping deploys green). That VPS is 1 vCPU (`nproc`
  // confirmed), so Next's default worker-parallelism for static
  // generation buys zero real speed there regardless. Forcing serial
  // (single-worker) generation was tried as a suspected root-cause fix —
  // it did NOT eliminate the flakiness on its own (retries were still
  // needed after this was added), so treat this as a reasonable
  // no-downside setting for a single-core box, not a confirmed fix. No
  // effect on Vercel or any multi-core environment beyond losing that
  // same parallelism there too — acceptable given this repo's only real
  // deploy target today is that one VPS (docs/deployment.md).
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  // Business logic never lives here (Phase 2 §3.2/§23's "thin client" rule)
  // — this file only wires framework plumbing (i18n, image domains for R2
  // file previews).
  images: {
    remotePatterns: [
      // R2 presigned URLs / public branding assets (Phase 2 §7). Add a
      // second pattern here for a custom R2 public domain if one is
      // configured (see backend .env.example's R2_* vars) — presigned URLs
      // themselves come back from the API with a real hostname already, so
      // this just needs to match whatever that hostname is.
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      // Landing page marketing images (hero/showcase screenshots, OG image)
      // — served through this app's own backend as a public streaming
      // proxy (GET /landing-page/media/:id, see lib/landing-page/media-url.ts
      // and backend's landing-page-public.service.ts), not a public R2
      // domain. next/image treats an absolute URL as "remote" even when it
      // shares this app's own hostname, so it still needs allowlisting
      // here — this repo's only real deploy target is sh-erp.pro
      // (docs/deployment.md), plus localhost for local dev against a local
      // backend.
      {
        protocol: 'https',
        hostname: 'sh-erp.pro',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
