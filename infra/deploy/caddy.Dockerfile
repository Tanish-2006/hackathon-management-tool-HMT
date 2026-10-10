FROM oven/bun:1 AS web
WORKDIR /web
COPY apps/participant-api/frontend/package.json apps/participant-api/frontend/bun.lock ./
RUN bun install
COPY apps/participant-api/frontend ./
ARG VITE_API_URL=/api/v1
ARG VITE_ORGANIZER_API_URL=/organizer/api/v1
ARG VITE_DEMO_MODE=false
ENV VITE_API_URL=$VITE_API_URL VITE_ORGANIZER_API_URL=$VITE_ORGANIZER_API_URL VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN bun run build

FROM caddy:2-alpine
COPY infra/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist/public /srv
