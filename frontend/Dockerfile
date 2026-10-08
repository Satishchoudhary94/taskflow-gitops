# ------------------------------------------------------------------
# TaskFlow frontend — production image
#
#   1. build   — Vite production build (static assets)
#   2. runtime — nginx-unprivileged: non-root (uid 101), listens on 8080
#
# The backend API URL is injected at CONTAINER STARTUP from the API_URL
# env var (entrypoint script → /config.js), so this image is
# environment-agnostic: build once, run anywhere (Compose today, K8s later).
# ------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.d/50-runtime-config.sh /docker-entrypoint.d/50-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
