# syntax=docker/dockerfile:1.7
# WO-121 (SDD-006 "Local y despliegue"): multi-stage image for @prdm/server. Built with the *repo root*
# as context (`docker build -f packages/server/Dockerfile .`) because npm workspaces need every
# dependency package's manifest and, for the runtime `import` condition, its built `dist/` — `@prdm/core`,
# `@prdm/contracts` and `@prdm/db` are all workspace dependencies of `@prdm/server` (see
# packages/server/package.json), and `@prdm/app`'s bundle is what `main.ts` serves as the SPA.
#
# Base pinned by digest (not just the `-bookworm-slim` tag) so the exact same bytes get rebuilt every
# time; re-resolve with `docker pull node:24.21.0-bookworm-slim && docker inspect --format
# '{{index .RepoDigests 0}}' node:24.21.0-bookworm-slim` when bumping the Node version.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

FROM ${NODE_IMAGE} AS build
WORKDIR /repo

# Manifests only, first, so `npm ci` is cached until a package.json or the lockfile actually changes.
COPY package.json package-lock.json ./
COPY packages/app/package.json packages/app/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

# Full source (see Dockerfile.dockerignore for exclusions), then the two builds `main.ts` needs at
# runtime: `tsc -b` for @prdm/server + its workspace deps (dist/*.js, the plain `import` condition), and
# Vite for the SPA bundle main.ts serves from packages/app/dist.
COPY . .
RUN npm run build
RUN npm run build --workspace=@prdm/app

# Workspace-aware prune: keeps every workspace's `dependencies` (and their transitive deps) while
# dropping devDependencies repo-wide, without a second `npm ci` pass that could drift from the lockfile.
RUN npm prune --omit=dev
# `mkdir -p` guarantees these exist (even empty) so the runtime stage's COPY of them never fails,
# regardless of whether npm's resolver nests any package under a workspace's own node_modules this time.
RUN mkdir -p packages/db/node_modules packages/server/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only the pruned install tree plus the built outputs main.ts actually loads/serves — no src/, no tests,
# no dev tooling.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=node:node /repo/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /repo/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /repo/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=node:node /repo/packages/server/dist ./packages/server/dist
COPY --from=build --chown=node:node /repo/packages/app/dist ./packages/app/dist
# npm nests a package under a workspace's own node_modules instead of hoisting it to the root when
# versions can't dedupe (here: `better-auth`, a dependency of both @prdm/db and @prdm/server) — copy
# those per-workspace node_modules too, or Node's resolver can't find them from packages/db/dist or
# packages/server/dist.
COPY --from=build --chown=node:node /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=build --chown=node:node /repo/packages/server/node_modules ./packages/server/node_modules

# The image's built-in non-root user (uid 1000) — never root at runtime.
USER node

EXPOSE 4601

# No curl/wget in the `-slim` base: a one-line ESM script using the global `fetch` (Node 24) is enough,
# and a non-2xx response or a thrown network error both exit non-zero.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const p=process.env.PRDM_SERVER_PORT||'4601';const r=await fetch(`http://127.0.0.1:${p}/api/health`);if(!r.ok)process.exit(1);"]

CMD ["node", "packages/server/dist/main.js"]
