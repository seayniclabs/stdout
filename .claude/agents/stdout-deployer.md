---
name: stdout-deployer
description: Autonomous deployment agent for StdOut - handles Docker builds, health checks, and production deployments
tags: [deployment, automation, docker]
---

# StdOut Deployment Agent

## Purpose

Autonomously deploy StdOut to production with zero-downtime updates, health verification, and automatic rollback on failure.

## Capabilities

- Docker image builds with security scanning
- Blue-green deployment strategy
- Health check validation
- Automatic rollback on failure
- Database migration automation
- Configuration validation

## Usage

```bash
# Deploy to production
claude agent run stdout-deployer --args "environment=production version=latest"

# Deploy specific version
claude agent run stdout-deployer --args "environment=staging version=v1.2.1"

# Rollback to previous version
claude agent run stdout-deployer --args "action=rollback environment=production"
```

## Deployment Workflow

### 1. Pre-Deployment Validation

```bash
# Verify all prerequisites
- Docker daemon accessible
- Secrets available at /Volumes/data/secrets/
- Database backup recent (<24h)
- Sufficient disk space (>10GB free)
- No active incidents in production
```

### 2. Build Phase

```bash
# Build Docker image
docker build -t stdout:${VERSION} .

# Security scan
trivy image --severity HIGH,CRITICAL stdout:${VERSION}

# Tag for deployment
docker tag stdout:${VERSION} stdout:blue
```

### 3. Database Migration

```bash
# Backup current database
cp /data/stdout.db /data/backups/stdout-${TIMESTAMP}.db

# Run migrations in test mode
docker run --rm \
  -v /data:/data \
  -e DB_PATH=/data/stdout.db \
  stdout:blue \
  node scripts/migrate.js --dry-run

# Apply migrations
docker run --rm \
  -v /data:/data \
  -e DB_PATH=/data/stdout.db \
  stdout:blue \
  node scripts/migrate.js
```

### 4. Blue-Green Deployment

```bash
# Start new container (blue)
docker run -d \
  --name stdout-blue \
  -p 3001:3000 \
  -v /data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file /Volumes/data/secrets/stdout.env \
  --health-cmd "wget -qO- http://127.0.0.1:3000/healthz || exit 1" \
  --health-interval 10s \
  --health-timeout 5s \
  --health-retries 3 \
  stdout:blue

# Wait for health check
timeout 60s bash -c 'until docker inspect --format="{{.State.Health.Status}}" stdout-blue | grep -q "healthy"; do sleep 2; done'

# Smoke test new instance
curl -f http://localhost:3001/health
curl -f http://localhost:3001/app/health
```

### 5. Traffic Switch

```bash
# Update nginx upstream
sed -i 's/localhost:3000/localhost:3001/' /etc/nginx/sites-available/stdout
nginx -t && systemctl reload nginx

# Wait 30s for connections to drain
sleep 30

# Verify new instance handling traffic
tail -f /var/log/nginx/access.log | grep -q "200 OK"
```

### 6. Cleanup

```bash
# Stop old container (green)
docker stop stdout-green
docker rm stdout-green

# Rename blue to green for next deployment
docker rename stdout-blue stdout-green

# Update port binding
docker stop stdout-green
docker rm stdout-green
docker run -d \
  --name stdout-green \
  -p 3000:3000 \
  -v /data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file /Volumes/data/secrets/stdout.env \
  stdout:blue

# Revert nginx
sed -i 's/localhost:3001/localhost:3000/' /etc/nginx/sites-available/stdout
nginx -t && systemctl reload nginx
```

### 7. Rollback (if needed)

```bash
# Stop failed deployment
docker stop stdout-blue
docker rm stdout-blue

# Restore database from backup
cp /data/backups/stdout-${LAST_BACKUP}.db /data/stdout.db

# Verify old instance still running
docker ps | grep stdout-green

# Alert operators
slack-post-filtered stdout-alerts "Deployment failed - rolled back to previous version" --priority=high
```

## Health Checks

```bash
# Application health
curl -f http://localhost:3000/health || exit 1

# Database connectivity
docker exec stdout-green node -e "require('./src/lib/db').getDb().select().from(require('./src/lib/db').schema.users).limit(1)"

# External dependencies
curl -f ${WINDLASS_URL}/health
curl -f ${OLLAMA_URL}/api/tags
```

## Monitoring Integration

```bash
# Register deployment event in StdOut
curl -X POST http://localhost:3000/app/api/incidents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "StdOut ${VERSION} deployed to ${ENVIRONMENT}",
    "description": "Automated deployment completed successfully",
    "severity": "low",
    "tags": "deployment,automation",
    "resolved": true
  }'

# Update Grafana annotation
curl -X POST ${GRAFANA_URL}/api/annotations \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
  -d '{
    "text": "StdOut ${VERSION} deployed",
    "tags": ["deployment"]
  }'
```

## Configuration

Environment variables required:

- `ENVIRONMENT` - production|staging|development
- `VERSION` - Image tag to deploy
- `SECRET_KEY` - Session encryption key
- `APP_URL` - Public URL
- `WINDLASS_URL` - Windlass scheduler URL
- `OLLAMA_URL` - Ollama API URL (optional)
- `ANTHROPIC_API_KEY` - Claude API key (optional)
- `RESEND_API_KEY` - Email API key (optional)

## Safety Guardrails

1. **Never deploy to production without**:
   - Recent database backup
   - Passing health checks
   - Security scan clearance

2. **Always**:
   - Test migrations in dry-run mode first
   - Keep previous container running during switchover
   - Verify health before traffic switch
   - Wait for connection drain before cleanup

3. **Auto-rollback triggers**:
   - Health check fails after 60s
   - 5xx error rate >5%
   - Database migration failure
   - Container crashes within 5 minutes

## Lessons

- **2026-07-23** — `docker-build-timeout`: Always set build timeout (--build-arg TIMEOUT=300) to prevent hanging builds blocking the pipeline.
- **2026-07-23** — `health-check-timing`: Wait at least 30s after container start before checking health - startup time varies by system load.
