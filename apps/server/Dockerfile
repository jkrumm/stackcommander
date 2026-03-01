# Download Docker CLI static binary + docker-rollout in a throw-away stage.
# Static binaries work on any Linux regardless of libc version.
FROM alpine:3.21 AS tool-downloader
ARG DOCKER_TGZ_SHA256=4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640
ARG DOCKER_COMPOSE_SHA256=dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372
RUN apk add --no-cache curl \
  && curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz" -o /tmp/docker.tgz \
  && echo "${DOCKER_TGZ_SHA256}  /tmp/docker.tgz" | sha256sum -c - \
  && tar xz --strip-components=1 -C /usr/local/bin -f /tmp/docker.tgz docker/docker \
  && curl -fsSL "https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-linux-x86_64" \
     -o /usr/local/bin/docker-compose-plugin \
  && echo "${DOCKER_COMPOSE_SHA256}  /usr/local/bin/docker-compose-plugin" | sha256sum -c - \
  && chmod +x /usr/local/bin/docker-compose-plugin

FROM oven/bun:1.3.9-slim AS runner
WORKDIR /app

COPY --from=tool-downloader /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /usr/local/lib/docker/cli-plugins
COPY --from=tool-downloader /usr/local/bin/docker-compose-plugin /usr/local/lib/docker/cli-plugins/docker-compose

ARG VERSION=dev
ENV NODE_ENV=production
ENV VERSION=$VERSION

COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/marketing/package.json ./apps/marketing/package.json
COPY packages/rollhook/package.json ./packages/rollhook/package.json
COPY e2e/package.json ./e2e/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

COPY packages/rollhook ./packages/rollhook
COPY apps/server ./apps/server
COPY tsconfig.json ./

RUN mkdir -p /app/data

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD bun -e "fetch('http://localhost:7700/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 7700
CMD ["bun", "run", "apps/server/server.ts"]
