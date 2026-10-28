# Sara's container image (docker-compose.yml builds it; scripts/release-docker.sh builds the
# published multi-arch image for linux/amd64 + linux/arm64 at ghcr.io/farena-ai/sara).
#
# NODE_VERSION is the same pinned Node.js release as deploy/install.sh (test/packaging.test.ts
# checks they match), so a container and a native install run the same runtime.
ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-slim

ARG SARA_VERSION=dev
LABEL org.opencontainers.image.title="Sara" \
      org.opencontainers.image.description="A self-hosted AI companion and coding partner." \
      org.opencontainers.image.source="https://github.com/farena-ai/sara" \
      org.opencontainers.image.url="https://sara.backstagecoding.com" \
      org.opencontainers.image.documentation="https://github.com/farena-ai/sara/blob/main/docs/INSTALL.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Frank Arena and Backstage Coding" \
      org.opencontainers.image.version="${SARA_VERSION}"

# git and curl for her coding tools; certificates for HTTPS; tini reaps the processes her tools
# leave behind and passes stop signals on.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --shell /usr/sbin/nologin sara-tools

WORKDIR /app
ENV NODE_ENV=production \
    SARA_DATA=/data \
    SARA_HOST=0.0.0.0 \
    SARA_PORT=7860 \
    SARA_TOOLS_USER=sara-tools

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY web ./web
COPY persona ./persona
COPY templates ./templates

# Root on purpose, but not a full root: the server starts as the container's root only so it can
# run her commands (shell, MCP servers) as the separate "sara-tools" user, which can't read Sara's
# data (keys, database); see src/tools/sandbox.ts. docker-compose.yml drops every capability but
# the six that needs and sets no-new-privileges. Running the whole container as an ordinary user
# (`--user 1000:1000`, with /data owned by that user) also works, but then her commands run as
# that same user and CAN read her keys, so it is the weaker choice.
RUN mkdir -p /data && chmod 711 /data
VOLUME ["/data"]
EXPOSE 7860

# Follows SARA_PORT if you change it (the container listens on every address, so ask loopback).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SARA_PORT||7860)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/main.ts"]
