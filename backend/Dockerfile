# SH ERP API — backend container image.
#
# Per "SH ERP v2 — Phase 2 Architecture.md" §17.1: one multi-stage image,
# built from the REPO ROOT (not `backend/`) as the build context, since
# `backend/package.json`'s own `"prisma": {"schema": "../prisma/schema.prisma"}`
# points one directory above `backend/` — a `backend/`-only build context
# can't see the schema at all. Build with:
#
#   docker build -f backend/Dockerfile -t sh-erp-api .
#
# from the repo root. Railway is configured to do exactly this (root
# directory left at the repo root, Dockerfile path set to `backend/Dockerfile`
# — see docs/deployment.md).
#
# Same image runs both the API and (once BullMQ/Redis background jobs are
# actually wired up — backend/README.md's "What's NOT built yet" #2, not
# built as of this pass) a worker service, differing only in start command,
# per §17.1's "one image to build and scan, not two." Only the API start
# command exists today (`node dist/main.js`); a worker command will be
# added to this same image once that module exists, not as a second image.

# ---- deps: install once, cached across builds unless package files change ----
FROM node:20-slim AS deps
WORKDIR /repo
COPY backend/package.json backend/package-lock.json* ./backend/
COPY prisma ./prisma
RUN cd backend && npm ci
# Requires real network access to binaries.prisma.sh at build time (this
# sandbox could never do this — see backend/README.md's standing Prisma
# gap — but a real CI/Railway build environment has normal internet access
# and this step is expected to just work there).
RUN cd backend && npx prisma generate --schema=../prisma/schema.prisma

# ---- build: compile TypeScript ----
FROM deps AS build
WORKDIR /repo
COPY backend ./backend
RUN cd backend && npm run build

# ---- runtime: slim, non-root, only what's needed to run ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nestjs
WORKDIR /app
COPY --from=build /repo/backend/dist ./dist
COPY --from=build /repo/backend/node_modules ./node_modules
COPY --from=build /repo/backend/package.json ./package.json
# Real bug found and fixed during the Hostinger-VPS deployment-prep pass:
# this runtime stage never copied `prisma/` (schema.prisma + migrations/)
# at all — the generated Prisma Client (already baked into node_modules
# above) doesn't need it for normal queries, but `prisma migrate deploy`
# (docker-compose.prod.yml's migration step, and any future Railway
# release-phase command that runs it from inside this same image) reads
# schema.prisma and the migrations directory straight off disk at runtime.
# Without this, `npx prisma migrate deploy` inside a container built from
# this Dockerfile would fail immediately with a missing-file error — never
# caught before now because no docker-compose/CI step had actually run a
# migration from inside this exact built image until this pass.
COPY --from=build /repo/prisma ./prisma
USER nestjs
EXPOSE 3000
# Railway's healthcheck path is /health (docs/deployment.md) — served by
# the NestJS app itself, not a separate container-level HEALTHCHECK here.
CMD ["node", "dist/main.js"]
