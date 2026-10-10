FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

FROM base AS builder
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/organizer-api/package.json apps/organizer-api/tsconfig.json apps/organizer-api/tsconfig.build.json ./apps/organizer-api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --filter "{./apps/organizer-api}..."
RUN pnpm --filter @hmt/database exec prisma generate \
 && pnpm --filter "{./apps/organizer-api}^..." run build
COPY apps/organizer-api/src ./apps/organizer-api/src
RUN pnpm --dir apps/organizer-api run build

FROM base AS runtime
ENV NODE_ENV=production ORGANIZER_API_PORT=3002
COPY --from=builder --chown=node:node /app /app
WORKDIR /app/apps/organizer-api
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3002/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
