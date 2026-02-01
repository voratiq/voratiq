FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    bubblewrap \
    socat \
    ripgrep \
    python3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build
RUN npm link

RUN chmod +x \
    tests/docker/hello-world/entrypoint.sh \
    tests/docker/hello-world/stage-codex.sh

ENTRYPOINT ["/app/tests/docker/hello-world/entrypoint.sh"]
