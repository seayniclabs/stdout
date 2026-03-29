---
title: "Docker Container Auto-Restart and Health Check Patterns"
type: guide
tags: docker, health-check, monitoring, compose, reliability
---

## Why Health Checks Matter

Docker's default behavior is to consider a container "running" if the main process hasn't exited. A web server can be alive but returning 500s on every request, and Docker won't notice. Health checks fix this by testing whether the service is actually functional.

## Compose Health Check Patterns

### HTTP Service (API, Web App)

```yaml
services:
  myapp:
    image: myapp:latest
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

`start_period` gives the container time to boot before health checks count. Without it, slow-starting apps (Java, .NET) will be marked unhealthy during startup.

### Database (PostgreSQL)

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### Database (SQLite-backed App)

SQLite doesn't have a server to ping. Health check the app itself:

```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
  interval: 30s
  timeout: 5s
  retries: 3
```

Use `wget --spider` if `curl` isn't in the container image (common with Alpine-based images).

### Redis

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
```

## Restart Policies

| Policy | Behavior | Use When |
|--------|----------|----------|
| `no` | Never restart | One-shot tasks, migrations |
| `on-failure` | Restart only on non-zero exit | Scripts that should retry on crash |
| `unless-stopped` | Always restart unless manually stopped | Most services |
| `always` | Always restart, even after `docker stop` | Critical infra (proxy, DNS, auth) |

For a home lab, `unless-stopped` is the right default. It survives reboots (Docker Desktop restarts containers) but respects manual `docker stop` commands during maintenance.

## Dependency Ordering with Health Checks

Health checks become powerful when combined with `depends_on` conditions:

```yaml
services:
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    image: myapp:latest
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

This ensures `app` doesn't start until `db` is actually accepting connections — not just "container is running." Without the `service_healthy` condition, your app will crash on startup trying to connect to a database that's still initializing.

## External Health Check Script

For comprehensive monitoring, run a script outside Docker that checks all your containers:

```bash
#!/bin/bash
# Check all containers with health checks
docker ps --format '{{.Names}} {{.Status}}' | while read name status; do
  if echo "$status" | grep -q "unhealthy"; then
    echo "UNHEALTHY: $name — restarting"
    docker restart "$name"
    # Send alert (webhook, email, Telegram, etc.)
  fi
done
```

Schedule this with cron (Linux) or launchd (macOS) every 5-15 minutes. It catches containers that Docker's built-in restart policy missed — for example, a service that's "healthy" by Docker's definition but returning errors.

## Practical Tips

**Don't health check with the app's main process.** A health check that runs the same binary as the service (e.g., `node healthcheck.js` for a Node app) adds memory and CPU overhead. Use lightweight tools: `curl`, `wget --spider`, `pg_isready`, `redis-cli ping`.

**Set `start_period` generously.** A container that fails health checks during startup will be marked unhealthy and potentially restarted in a loop. I set `start_period` to at least 2x the expected boot time.

**Log health check failures.** `docker inspect --format='{{json .State.Health}}' <container>` shows the last 5 health check results, including stdout/stderr from failed checks. This is often the fastest way to diagnose a flapping service.

**Avoid `curl -f` in minimal images.** Alpine images often don't include curl. Use `wget --spider -q` instead, or install curl in your Dockerfile.
