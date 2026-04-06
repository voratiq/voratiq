FROM node:20.19.6-bookworm-slim AS base

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
# npm 10.8+ regressed Linux installs for this lockfile; keep Docker scenarios on 10.7.0.
RUN npm install -g npm@10.7.0
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

CMD ["npm", "run", "test:sandbox"]
