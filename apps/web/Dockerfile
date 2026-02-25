FROM oven/bun:1.3.9-slim AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/rollhook/package.json ./packages/rollhook/package.json
COPY e2e/package.json ./e2e/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/rollhook ./packages/rollhook
COPY apps/web ./apps/web

RUN cd apps/web && bun run build

FROM nginx:1.27-alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' \
  > /etc/nginx/conf.d/default.conf
EXPOSE 80
