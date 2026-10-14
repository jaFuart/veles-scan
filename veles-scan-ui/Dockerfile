# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy build-time values — the app is fully dynamic (no static DB routes).
# Using ARG keeps them out of the final image layers.
ARG POSTGRES_HOST=localhost
ARG POSTGRES_PORT=5432
ARG POSTGRES_DB=veles_ui
ARG POSTGRES_USER=pipeline
ARG POSTGRES_PASSWORD=pipeline
ARG BACKEND_API_URL=http://localhost:8080
# Expose as ENV only for the build step, then they vanish from the runner stage
ENV POSTGRES_HOST=$POSTGRES_HOST \
    POSTGRES_PORT=$POSTGRES_PORT \
    POSTGRES_DB=$POSTGRES_DB \
    POSTGRES_USER=$POSTGRES_USER \
    POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
    BACKEND_API_URL=$BACKEND_API_URL \
    NODE_ENV=production

RUN npm run build

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only copy what next start actually needs
COPY --from=deps    /app/node_modules  ./node_modules
COPY --from=builder /app/.next         ./.next
COPY --from=builder /app/public        ./public
COPY package.json ./

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=5 \
  CMD wget -qO /dev/null http://localhost:3000/login || exit 1

CMD ["node_modules/.bin/next", "start"]
