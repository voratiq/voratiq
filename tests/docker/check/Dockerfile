# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base

ENV TZ=America/Los_Angeles

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
  && rm -rf /var/lib/apt/lists/* \
  && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
  && echo ${TZ} > /etc/timezone

WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

CMD ["npm", "run", "check"]
