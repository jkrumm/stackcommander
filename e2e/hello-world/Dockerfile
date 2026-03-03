FROM oven/bun:1.3.9-slim

WORKDIR /app

ARG BUILD_VERSION=unknown
ENV BUILD_VERSION=${BUILD_VERSION}

COPY server.ts .

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=5 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

CMD ["bun", "server.ts"]
