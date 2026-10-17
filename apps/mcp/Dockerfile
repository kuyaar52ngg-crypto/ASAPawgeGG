# syntax=docker/dockerfile:1
# Build context = repo root:  docker build -f apps/mcp/Dockerfile .
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @asap/mcp...
COPY packages packages
COPY apps/mcp apps/mcp
RUN pnpm --filter @asap/db generate
EXPOSE 3333
CMD ["pnpm", "--filter", "@asap/mcp", "start"]
