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
# Real VPS production bug, found and fixed: `node:20-slim` is Debian
# bookworm-based and ships `libssl3` (OpenSSL 3.0.x) as a *library*, but has
# no `openssl` package (CLI or dev headers) installed by default — "slim"
# strips it. Prisma's own platform-detection (`@prisma/get-platform`, run
# as part of `prisma generate` below) shells out to `openssl version` to
# decide which prebuilt engine binary to fetch/cache; with no `openssl`
# binary on PATH to query, it silently fell back to a stale default guess
# (`debian-openssl-1.1.x`) instead of the correct `debian-openssl-3.0.x` —
# an engine built against a libssl major version this image's actual
# `libssl3` can't satisfy (`libssl.so.1.1: cannot open shared object file`).
# Installing the real `openssl` Debian package (not a manual libssl symlink
# hack) fixes detection at the source, before `prisma generate` ever runs,
# so the CORRECT engine binaries get fetched and cached in this layer.
# `apt-get install` runs before `COPY`ing any repo files so this layer
# stays cached across ordinary code changes.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
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
# Same root cause as the `deps` stage above, second half of the fix: even
# with the CORRECT `debian-openssl-3.0.x` engine binaries now cached (fixed
# above), those binaries still dynamically link against `libssl.so.3` AT
# RUNTIME — and this stage starts fresh `FROM node:20-slim`, so it does not
# inherit anything installed in `deps`/`build`. Without `libssl3` actually
# present here too, the schema/query engine copied in via `COPY
# --from=build` below would fail to start in THIS stage even though it was
# the right binary all along. Installed as root, before `USER nestjs`
# drops privileges (matches the ordering already established for the
# ownership fix below) — the real Debian package, not a manually vendored
# `.so` file.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nestjs
WORKDIR /app
# Real VPS production bug, found and fixed: every stage above runs as root
# (no USER directive before this one), so every COPY --from=build below was
# landing as root:root in the final image — including
# node_modules/@prisma/engines. `USER nestjs` (below) then drops the actual
# running process to uid 1001, which owned none of it. Prisma's engine
# resolver touches/verifies its cached engine binaries under
# node_modules/@prisma/engines on every PrismaClient instantiation and every
# `prisma migrate` invocation — even when the binary is already correctly
# cached from `prisma generate` in the `deps` stage and nothing actually
# needs downloading, that verification step still does a real filesystem
# write (a lock/checksum touch), not just a read. Root-owned, non-writable
# files under an unprivileged runtime user is exactly what turns that
# routine touch into "Can't write to /app/node_modules/@prisma/engines".
# This is a container-permissions bug, not a Prisma bug and not
# regeneration-at-runtime — confirmed by the error itself (a plain
# "Permission denied" on `touch`, not a network/download error), and
# consistent with `deps` already being the only stage that ever calls
# `prisma generate` (line 32) — runtime has no code path that re-runs it.
# `chown nestjs:nodejs /app` covers the directory itself (created earlier
# under root by WORKDIR, which `--chown` on the COPYs below does not
# retroactively touch); `--chown` on each COPY sets ownership on exactly
# what's copied, in the same layer, with no extra recursive chown pass over
# a potentially large node_modules tree.
RUN chown nestjs:nodejs /app
COPY --from=build --chown=nestjs:nodejs /repo/backend/dist ./dist
COPY --from=build --chown=nestjs:nodejs /repo/backend/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /repo/backend/package.json ./package.json
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
COPY --from=build --chown=nestjs:nodejs /repo/prisma ./prisma
USER nestjs
EXPOSE 3000
# Railway's healthcheck path is /health (docs/deployment.md) — served by
# the NestJS app itself, not a separate container-level HEALTHCHECK here.
CMD ["node", "dist/main.js"]
