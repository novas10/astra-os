# AstraOS — Production Deployment Checklist

## Pre-Deployment

- [ ] **Secrets configured** — all `.env` values set for production:
  - `ANTHROPIC_API_KEY` — valid Anthropic key
  - `JWT_SECRET` — `openssl rand -hex 32` (unique, random)
  - `MASTER_ENCRYPTION_KEY` — `openssl rand -hex 32` (for CredentialVault)
  - `ASTRA_API_KEYS` — comma-separated admin API keys
  - `REDIS_PASSWORD` — strong password matching docker-compose
- [ ] **CORS origins set** — `ASTRA_CORS_ORIGINS=https://your-domain.com` (no wildcard `*`)
- [ ] **NODE_ENV=production** — disables stack traces in error responses
- [ ] **HOST=127.0.0.1** — bind to localhost if behind reverse proxy
- [ ] **SSL/TLS configured** — via Nginx, Caddy, or cloud provider
- [ ] **Log level set** — `LOG_LEVEL=info` (not debug in production)

## Build & Deploy

```bash
# 1. Install dependencies
npm ci --production=false

# 2. Build backend + dashboard
npm run build
npm run dashboard:build

# 3. Run tests
npm test

# 4. Start with PM2
pm2 start ecosystem.config.cjs

# Or with Docker
docker compose up -d
```

## Post-Deployment

- [ ] Verify `GET /health` returns `status: operational`
- [ ] Verify dashboard loads at `https://your-domain.com`
- [ ] Verify auth — `GET /api/agents` returns 401 without key, 200 with key
- [ ] Run security scan — `POST /api/security/scan`
- [ ] Check logs — `tail -f logs/astra.log` (no errors)
- [ ] Set up monitoring — point alerting at `/health` and `/api/metrics`

## Backup & Restore

### Backup

AstraOS stores data in two locations:

| Data | Location | Method |
|------|----------|--------|
| SQLite DB (users, tenants) | `.astra-data/astra.db` | File copy (with WAL checkpoint) |
| Memory (conversations, embeddings) | `.astra-memory/` | Directory copy |
| Credential vault | `.astra-vault/` | Directory copy (encrypted) |
| Logs | `logs/` | Optional archive |

**Automated backup script:**

```bash
#!/bin/bash
# backup.sh — Run daily via cron: 0 2 * * * /opt/astra-os/backup.sh
set -e

BACKUP_DIR="/backups/astra/$(date +%Y%m%d-%H%M%S)"
ASTRA_DIR="/opt/astra-os"
mkdir -p "$BACKUP_DIR"

# Checkpoint WAL to flush pending writes
sqlite3 "$ASTRA_DIR/.astra-data/astra.db" "PRAGMA wal_checkpoint(TRUNCATE);"

# Copy data files
cp "$ASTRA_DIR/.astra-data/astra.db" "$BACKUP_DIR/"
cp -r "$ASTRA_DIR/.astra-memory" "$BACKUP_DIR/"
cp -r "$ASTRA_DIR/.astra-vault" "$BACKUP_DIR/" 2>/dev/null || true

# Compress
tar czf "$BACKUP_DIR.tar.gz" -C "$(dirname $BACKUP_DIR)" "$(basename $BACKUP_DIR)"
rm -rf "$BACKUP_DIR"

# Keep last 30 days
find /backups/astra/ -name "*.tar.gz" -mtime +30 -delete

echo "[Backup] Completed: $BACKUP_DIR.tar.gz"
```

### Restore

```bash
# 1. Stop AstraOS
pm2 stop astra-os  # or: docker compose down

# 2. Extract backup
tar xzf /backups/astra/20260301-020000.tar.gz -C /tmp/restore/

# 3. Replace data
cp /tmp/restore/astra.db /opt/astra-os/.astra-data/astra.db
cp -r /tmp/restore/.astra-memory /opt/astra-os/.astra-memory
cp -r /tmp/restore/.astra-vault /opt/astra-os/.astra-vault

# 4. Restart
pm2 restart astra-os  # or: docker compose up -d

# 5. Verify
curl http://localhost:3000/health
```

## Kubernetes Deployment

```bash
# Apply manifests
kubectl apply -f deploy/k8s/astra-os.yaml

# Update secrets (edit values first!)
kubectl -n astra-os edit secret astra-secrets

# Check status
kubectl -n astra-os get pods
kubectl -n astra-os logs -f deployment/astra-os
```

## Monitoring Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | System status, uptime, component health |
| `GET /api/metrics` | Counters, histograms, percentiles |
| `GET /api/traces` | Recent OpenTelemetry spans |
| `GET /api/security/report` | Security grade (A+ to F) |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 401 on all routes | Verify `ASTRA_API_KEYS` is set, check `X-API-Key` header |
| Dashboard blank | Run `npm run dashboard:build`, check Nginx config |
| Slow responses | Check `/api/metrics` for p99 latency, verify LLM provider status |
| DB locked errors | Ensure WAL mode: `sqlite3 .astra-data/astra.db "PRAGMA journal_mode;"` |
| High memory | Check log rotation, restart with PM2 (`pm2 restart`) |
