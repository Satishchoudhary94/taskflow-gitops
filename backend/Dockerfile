# ------------------------------------------------------------------
# TaskFlow backend — production image
#
# Multi-stage build:
#   1. build   — full dev dependencies, compile TypeScript → dist/
#   2. deps    — production-only node_modules
#   3. runtime — minimal image: prod deps + dist + migrations, non-root
#
# The container runs as the unprivileged "node" user and starts node
# directly (exec form) so it is PID 1 and receives SIGTERM for graceful
# shutdown. Listens on 0.0.0.0:$PORT (default 3000).
# ------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
