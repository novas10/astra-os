# AstraOS v4.0 — Multi-stage Docker Build

# Stage 1: Build backend
FROM node:22-slim AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Build dashboard
FROM node:22-slim AS dashboard-builder
WORKDIR /app/packages/dashboard
COPY packages/dashboard/package*.json ./
RUN npm ci
COPY packages/dashboard/ ./
RUN npm run build

# Stage 3: Runtime
FROM node:22-slim AS runtime
WORKDIR /app

# Non-root user for security
RUN groupadd -r astra && useradd -r -g astra astra

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=dashboard-builder /app/packages/dashboard/dist ./public
COPY package.json ./
COPY skills/ ./skills/
COPY src/docs/openapi.yaml ./dist/docs/openapi.yaml

# Create workspace and logs directories
RUN mkdir -p workspace logs .astra-memory && chown -R astra:astra /app

USER astra

ENV NODE_ENV=production
ENV PORT=3000
ENV CANVAS_PORT=18793

EXPOSE 3000 18793

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
