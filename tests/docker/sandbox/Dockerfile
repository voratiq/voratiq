# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    bubblewrap \
    socat \
    ripgrep \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

CMD ["npm", "run", "test:sandbox"]
