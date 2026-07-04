# ---- Server Dockerfile ----
# Multi-stage: compile TS → JS, then run with Node (CommonJS)
FROM node:lts-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile
COPY server.ts ./
RUN npx tsc --target ES2020 --module commonjs --esModuleInterop true \
    --resolveJsonModule true --skipLibCheck true --outDir dist server.ts

# ---- Runtime stage ----
FROM node:lts-slim AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /build/dist/server.js ./server.js

# The server listens on a random port (listen(0)) and self-registers
# with server-manager. HOST_IP and SERVER_MANAGER_URL are injected by k8s.
ENV HOST_IP=""
ENV SERVER_MANAGER_URL="http://server-manager-svc.box-game.svc.cluster.local:4689"

CMD ["node", "server.js"]
