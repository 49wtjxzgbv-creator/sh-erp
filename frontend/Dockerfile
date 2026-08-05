# SH ERP frontend — container image for self-hosted deployment (Hostinger
# VPS, docs/deployment.md). NOT used by the Vercel deployment path — Vercel
# builds and serves this app natively, this Dockerfile exists purely for the
# self-hosted alternative.
#
# Build from the REPO ROOT, same reasoning as backend/Dockerfile even though
# this app has no cross-directory schema dependency — kept consistent so
# both images are built the same way from the same place:
#
#   docker build -f frontend/Dockerfile -t sh-erp-web .
#
# Uses `output: 'standalone'` (frontend/next.config.mjs) — Next.js traces
# the actual runtime dependency graph into `.next/standalone/` instead of
# needing the full `node_modules` tree at runtime. Per Next.js's own
# documented standalone-output convention, `public/` and `.next/static/`
# are NOT included in that trace automatically and must be copied in by
# hand — done explicitly below, not omitted.

# ---- deps: install once, cached across builds unless package files change ----
FROM node:20-slim AS deps
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# ---- build: compile the Next.js app ----
FROM node:20-slim AS build
WORKDIR /repo/frontend
COPY --from=deps /repo/frontend/node_modules ./node_modules
COPY frontend ./
# Build-time env vars a Next.js production build bakes into client bundles
# (NEXT_PUBLIC_* only — INTERNAL_API_BASE_URL is read at request time, not
# build time, since it's only ever used inside server-only route handlers).
# Real values are supplied by the deploy step (docs/deployment.md); this
# default lets a bare `docker build` still succeed for a local smoke test.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

# ---- runtime: slim, non-root, only the standalone trace + static assets ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nextjs && useradd --system --uid 1001 --gid nextjs nextjs
WORKDIR /app
COPY --from=build /repo/frontend/.next/standalone ./
COPY --from=build /repo/frontend/.next/static ./.next/static
COPY --from=build /repo/frontend/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# `.next/standalone/server.js` is Next's own generated entrypoint — not
# `next start` (standalone output is explicitly meant to be run this way,
# per Next.js's own documented convention).
CMD ["node", "server.js"]
