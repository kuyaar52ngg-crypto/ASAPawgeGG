# syntax=docker/dockerfile:1
# Build context = repo root:  docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# Used by the one-shot `migrate` compose service (prisma CLI + seed)
FROM deps AS tools
COPY . .
RUN pnpm rebuild @node-rs/argon2 esbuild prisma @prisma/engines || true
CMD ["pnpm", "--filter", "@asap/db", "migrate:deploy"]

FROM deps AS build
COPY . .
RUN pnpm --filter @asap/db generate
ENV NODE_ENV=production
RUN pnpm --filter @asap/web exec next build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd -m -u 1001 app
COPY --from=build --chown=app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
