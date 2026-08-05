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
    ],
  },
};

export default withNextIntl(nextConfig);
