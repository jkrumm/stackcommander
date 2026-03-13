FROM golang:1.25-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /rollhook ./cmd/rollhook

# Download Docker CLI static binary and Zot in a throw-away stage.
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

ARG TARGETARCH
ARG ZOT_VERSION=2.1.14
ARG ZOT_AMD64_SHA256=c96e2394e1d94ddd3439f3b19d1d2b707e5bcbf34fec49532805bf3cd734bfc7
ARG ZOT_ARM64_SHA256=e447ebe874d9b906feb2c769d535f1c8f4682f479a1320572c5201684b81c17c
RUN ZOT_ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") \
  && ZOT_SHA=$([ "$TARGETARCH" = "arm64" ] && echo "${ZOT_ARM64_SHA256}" || echo "${ZOT_AMD64_SHA256}") \
  && curl -fsSL \
     "https://github.com/project-zot/zot/releases/download/v${ZOT_VERSION}/zot-linux-${ZOT_ARCH}" \
     -o /usr/local/bin/zot \
  && echo "${ZOT_SHA}  /usr/local/bin/zot" | sha256sum -c - \
  && chmod +x /usr/local/bin/zot

# debian:12-slim provides glibc required by Zot's pre-built binaries.
FROM debian:12-slim AS runner
WORKDIR /app

# Install curl for the HEALTHCHECK — no build tools, no recommends.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY --from=tool-downloader /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /usr/local/lib/docker/cli-plugins
COPY --from=tool-downloader /usr/local/bin/docker-compose-plugin /usr/local/lib/docker/cli-plugins/docker-compose
COPY --from=tool-downloader /usr/local/bin/zot /usr/local/bin/zot
COPY --from=go-builder /rollhook /usr/local/bin/rollhook

ARG VERSION=dev
ENV VERSION=$VERSION

RUN mkdir -p /app/data

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -sf http://localhost:7700/health || exit 1

EXPOSE 7700
CMD ["/usr/local/bin/rollhook"]
