FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

RUN chmod +x tests/docker/codex-config-policy/entrypoint.sh

ENTRYPOINT ["/app/tests/docker/codex-config-policy/entrypoint.sh"]
