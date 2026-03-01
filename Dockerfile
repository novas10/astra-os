# AstraOS — Multi-stage Docker Build
# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Runtime
FROM node:22-slim AS runtime
WORKDIR /app

# Non-root user for security
RUN groupadd -r astra && useradd -r -g astra astra

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY skills/ ./skills/

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
