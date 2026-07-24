# Fork web container (additive fork IP). Builds the Thunderbolt frontend with
# demo/consumer/anonymous flags and serves it via nginx same-origin proxy.
# Deliberately NOT deploy/docker/frontend.Dockerfile (upstream, SSO-baked) — we
# do not edit upstream. Copies upstream nginx security-headers snippet (read-only).

# Stage 1: Build the static bundle
FROM oven/bun:latest AS build
WORKDIR /app

# Deps first for layer caching
COPY package.json bun.lock ./
COPY shared ./shared
RUN bun install --frozen-lockfile

# Frontend source
COPY src ./src
COPY public ./public
COPY index.html ./
COPY vite.config.ts tsconfig.json tsconfig.node.json ./
COPY components.json ./
COPY .storybook ./.storybook

# Demo build config baked into the bundle. VITE_AUTH_MODE is intentionally
# omitted (must not be "sso"). Do NOT copy the repo .env.production — it points
# VITE_THUNDERBOLT_CLOUD_URL at localhost:8000, wrong for same-origin.
ARG VITE_THUNDERBOLT_CLOUD_URL="/v1"
ARG VITE_AUTH_ENABLE_ANONYMOUS="true"
ARG VITE_BYPASS_WAITLIST="true"
ENV VITE_THUNDERBOLT_CLOUD_URL=$VITE_THUNDERBOLT_CLOUD_URL
ENV VITE_AUTH_ENABLE_ANONYMOUS=$VITE_AUTH_ENABLE_ANONYMOUS
ENV VITE_BYPASS_WAITLIST=$VITE_BYPASS_WAITLIST

RUN bunx vite build && find dist -name '*.map' -delete

# Stage 2: Serve with nginx
FROM nginx:alpine

# Upstream defaults; override in compose/k8s. THUNDERBOLT_-prefixed to dodge
# Kubernetes <SERVICE>_PORT injection.
ENV THUNDERBOLT_BACKEND_HOST=backend
ENV THUNDERBOLT_BACKEND_PORT=8000
ENV THUNDERBOLT_POWERSYNC_HOST=powersync
ENV THUNDERBOLT_POWERSYNC_PORT=8080

COPY dev-local/docker/web-nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/config/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
