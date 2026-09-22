# HMT Organizer API — production image (Fastify, port 3002).
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/organizer-api ./apps/organizer-api
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @hmt/organizer-api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ORGANIZER_API_PORT=3002
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/organizer-api/package.json ./apps/organizer-api/package.json
COPY apps/organizer-api/dist ./apps/organizer-api/dist
RUN corepack enable && pnpm install --prod --frozen-lockfile
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/api/v1/health || exit 1
USER node
CMD ["node", "apps/organizer-api/dist/main.js"]
