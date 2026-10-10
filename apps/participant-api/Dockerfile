FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

FROM base AS builder
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/participant-api/package.json apps/participant-api/nest-cli.json apps/participant-api/tsconfig.json apps/participant-api/tsconfig.build.json apps/participant-api/prisma.config.ts ./apps/participant-api/
COPY apps/participant-api/prisma ./apps/participant-api/prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --filter "{./apps/participant-api}..."
RUN pnpm --filter @hmt/database exec prisma generate \
 && pnpm --dir apps/participant-api exec prisma generate \
 && pnpm --filter "{./apps/participant-api}^..." run build
COPY apps/participant-api/src ./apps/participant-api/src
RUN pnpm --dir apps/participant-api run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=builder --chown=node:node /app /app
WORKDIR /app/apps/participant-api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/main.js"]
