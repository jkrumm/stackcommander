FROM oven/bun:1.3.9-slim AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/rollhook/package.json ./packages/rollhook/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.9-slim AS runner
WORKDIR /app

# Install Docker CLI + docker-rollout (server spawns these at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
     > /etc/apt/sources.list.d/docker.list \
  && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL https://github.com/wowu/docker-rollout/releases/download/v0.13/docker-rollout \
     -o /usr/local/lib/docker/cli-plugins/docker-rollout \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-rollout \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY packages/rollhook ./packages/rollhook
COPY apps/server ./apps/server
COPY tsconfig.json ./

RUN mkdir -p /app/data

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD bun -e "fetch('http://localhost:7700/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 7700
CMD ["bun", "run", "apps/server/server.ts"]
