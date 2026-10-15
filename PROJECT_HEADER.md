# StdOut — Project Header

## Project Identity

**StdOut** is an AI-assisted incident companion for self-hosters and solo developers. It turns past fixes into future answers via a living runbook that learns your infrastructure stack. Self-hosted, self-contained, and built for people running their own Docker services.

Three optional components:
- **StdOut Core** (port 8112) — incident tracking, AI diagnostics, knowledge base
- **Windlass** (port 8116) — schedule-aware Docker service manager
- **Observatory** (port 8080) — proactive monitoring with AI agents (Llama 3.2 3B watcher + Qwen 2.5 14B analyst)

- **Repo:** https://github.com/seayniclabs/stdout (public)
- **Dev Port:** 3000 (Astro dev), 8112 (production)
- **Container root:** /Volumes/data/containers/stdout/
- **Vault note:** Projects/StdOut/StdOut.md
- **Tech Spec:** Projects/StdOut/Tech Spec.md
- **License:** Personal use only; commercial requires license

## Assessment — 2026-10-07

### Errors & Risks
[HIGH] Windlass Docker socket mounted as rw — privilege escalation risk if untrusted containers run. Unchanged since 2026-06-10.

[MED] Rate limiting framework present; production enforcement unclear (tests toggle via env var). No evidence of live production validation.

[MED] TLS for Windlass ↔ StdOut missing — internal HTTP, no encryption. Unchanged since 2026-06-10.

[MED] Untracked runbooks directory (git status shows `??`) — may contain uncommitted operational docs or stale data. Verify it's not needed for deployment.

[LOW] Test encryption key hardcoded; production key separate (acceptable, no risk).

### Security (12-Control Checklist)
1. ✅ Auth: CSRF + HTTPOnly cookies
2. ✅ Secrets: Encrypted at rest, no hardcoded keys
3. ✅ Input Validation: Form validation + rate limiting framework
4. ✅ Network: Internal HTTP acceptable for LAN; public needs TLS wrapper
5. ⚠️ TLS: Inter-service HTTP (needs mTLS for untrusted networks)
6. ✅ Dependencies: CVE patching current (Astro/Node deps maintained)
7. ✅ Logging: Standard, no PII leakage
8. ⚠️ Rate Limiting: Framework present, production validation pending
9. ✅ Least Privilege: Windlass optional, incident isolation enforced
10. ✅ Backups: Not applicable (user self-hosted)
11. ⚠️ Container Hardening: Docker socket mounted rw (risk documented)
12. ✅ CORS/Headers: N/A (backend-only)

### Improvements (Since 2026-06-10)
[✓ DONE] GitHub Issues + Webhook connectors (shipped 2026-06-08)
[✓ DONE] Observatory degradation mode (Ollama optional)
[PENDING] Jira connector — deferred
[PENDING] TLS for Windlass ↔ StdOut
[PENDING] Rate limit production validation
[PENDING] Incident export PDF
[TODO] Clean up untracked runbooks directory

### Cost
Ollama 16GB optional (fallback to text). Self-hosted Observatory efficient.

### Performance
Astro SSR + better-sqlite3 fast. Windlass cron UTC-only (noted). Docker API calls scale linearly.

### Verdict
**Grade: B+** (unchanged from 2026-06-10) — Solid self-hosted incident platform. CVE patching current. GitHub/Webhook connectors shipped. Docker socket risk documented. TLS and production rate-limit validation still needed. Clean the untracked runbooks dir before next deployment.

**Last Updated:** 2026-10-07 (no major changes since June; runbooks dir needs cleanup)

## Last Decisions

- **Ticketing integration:** Framework added for external ticket connectors (Jira, GitHub, Zendesk) — wired via scheduler pattern, shipped 2026-06-08
- **Observatory dashboard:** Transformed to dark glassmorphism NOC style (2026-06-08)
- **Three-tier deployment:** StdOut only (core), StdOut + Windlass (schedule-aware), StdOut + Observatory (proactive monitoring with LLMs)
- **Windlass management:** Moved to optional profile; users choose based on schedule needs, Docker socket must be rw

## Current State

StdOut is a production incident companion for self-hosters and solo developers, live at https://stdout.seayniclabs.com. Latest commit (34b65e6) fixes Docker network filtering in container IP scan. Clean repository (no uncommitted changes). Three-component architecture: Core (8112) for incident tracking + AI diagnostics, Windlass (8116) for schedule-aware Docker management, Observatory (8080) for proactive monitoring with Llama 3.2 + Qwen 2.5 analysis. Built with Astro, deployed via Docker; public GitHub repo with personal-use license. Recent work: ticketing framework (Jira/GitHub/Zendesk), glassmorphism Observatory dashboard, optional profile management.

## Next Steps

1. Parked until Sonique v1: this standalone product was retired 2026-10-06. It continues as a Sonique module built from the skill bundle in ~/Projects/stdout-skill (scaffolded 2026-10-04). Plan, order and stopping rules live in the Sonique blueprint (`blueprint show sonique`); the old SaaS roadmap is in this file's git history.

## Resource Inventory

### Services Provided

| Service | URL | Port | Health Check | Notes |
|---------|-----|------|--------------|-------|
| StdOut Core | https://stdout.seayniclabs.com | 443 | GET /api/health | Incident tracking + AI diagnostics |
| Windlass | http://localhost:8116 | 8116 | GET /status.json | Schedule-aware Docker service manager (optional) |
| Observatory | http://localhost:8080 | 8080 | GET /health | Proactive monitoring with LLM analysis (optional) |

### Services Consumed

| Service | URL | Auth Method | Credentials Location | Notes |
|---------|-----|-------------|---------------------|-------|
| Anthropic API | https://api.anthropic.com | API key | Environment variable `ANTHROPIC_API_KEY` | Optional AI diagnostics (users can bring own key) |
| Resend | https://api.resend.com | API key | Environment variable `RESEND_API_KEY` | Email notifications |
| GitHub API | https://api.github.com | OAuth token | Environment variable | Ticketing integration (optional) |
| Docker Socket | unix:///var/run/docker.sock | Socket | `/var/run/docker.sock` | Windlass only; schedule-aware orchestration |

### External Dependencies

| Dependency | Version | Purpose | Documentation |
|------------|---------|---------|---------------|
| Astro | 5.17+ | SSR framework | https://astro.build |
| Node.js | 22+ | Runtime | https://nodejs.org |
| better-sqlite3 | 9.x | Database driver | https://github.com/WiseLibs/better-sqlite3 |
| Drizzle ORM | 0.x | Database ORM | https://orm.drizzle.team |
| Playwright | 1.x | E2E testing | https://playwright.dev |

### Secrets & Credentials

| Secret | Storage Location | Access Method | Notes |
|--------|------------------|---------------|-------|
| ANTHROPIC_API_KEY | Environment variable | App startup | Optional; users can provide their own |
| RESEND_API_KEY | Environment variable | App startup | Email notifications |
| GITHUB_OAUTH_TOKEN | Environment variable | Ticketing integration | Optional |
| ENCRYPTION_KEY | Environment variable `SECRET_KEY` | App startup | 32-character random string |

### Network & Infrastructure

| Resource | Value | Purpose | Notes |
|----------|-------|---------|-------|
| Container Name | stdout | Docker | Auto-restart enabled |
| Primary Port | 8112 | StdOut Core HTTP | Astro SSR server |
| Windlass Port | 8116 | Docker scheduler | Optional; requires socket mount rw |
| Observatory Port | 8080 | Monitoring | Optional; requires Ollama on host |
| Volume Mount | /data | Persistence | incidents.db, knowledge base, logs |
| Database File | /data/incidents.db | SQLite WAL | Auto-created on startup |
| Public Domain | stdout.seayniclabs.com | HTTPS via Tunnel | Cloudflare Tunnel ingress |
| TZ Environment | America/Chicago | Timezone | Required for correct cron times |

## Build & Deploy

### Local Development
```bash
npm install
npm run dev                              # Astro at localhost:3000
npm run test                             # Playwright (excludes rate limit tests)
npm run test:all                         # Full test suite
npm run test:smoke                       # Quick smoke test
```

### Production Build
```bash
npm run build                            # Compiles to dist/
npm run start                            # Runs dist/server/entry.mjs
# Production: http://localhost:8112 (see docker-compose at /Volumes/data/containers/stdout/)
```

### Docker (Core Only)
```bash
docker build -t stdout:latest .
docker run -p 8112:3000 \
  -e STDOUT_MODE=selfhost \
  -e DB_PATH=/data/stdout.db \
  -e SECRET_KEY=<32-char-random> \
  -e ANTHROPIC_API_KEY=<optional> \
  -e TZ=America/Chicago \
  -v stdout-data:/data \
  stdout:latest
```

### Docker with Windlass Profile
```bash
docker compose --profile windlass up -d
```
Starts StdOut (8112) + Windlass (8116). Requires `/opt/windlass/schedule.yaml` on host.

### Docker with Observatory Profile
```bash
docker compose --profile observatory up -d
```
Starts StdOut + Observatory (8080) + Prometheus (9090) + Loki. Requires Ollama running on host.

All containers must set `TZ=America/Chicago`.

## API Contract

### Public Endpoints
- `GET /` — Dashboard
- `GET /api/health` — Health check
- `GET /api/services` — Service list (Windlass optional)

### Core Endpoints (POST)
- `POST /api/incidents` — Create incident
- `POST /api/incidents/:id/fix` — Generate auto-fix and run it
- `POST /api/kb/save` — Save runbook entry

### Windlass Integration (if enabled)
- `GET /api/windlass/status` — Service status (poll from Windlass:8116)
- `POST /api/windlass/control/:service/:action` — start/stop/restart (proxies to Windlass)

### Observatory Integration (if enabled)
- `GET /api/alerts` — List active alerts
- `POST /api/incidents/from-alert/:alertId` — Create incident from Observatory alert

## Integration Points

- **Windlass:** Docker service scheduler (opt-in), exposes `/status.json`, HTTP port 8116
- **Observatory:** Proactive monitoring (opt-in), Prometheus/Loki/Tempo, auto-creates incidents on CRITICAL alerts
- **Anthropic API:** Optional AI diagnostics (users can bring their own key)
- **Resend:** Email notifications
- **Ticketing (framework):** Jira, GitHub, Zendesk connectors (wired, not all implemented yet)
- **Cloudflare Tunnel:** Ingress from seaynicroute.com to container:8112

## Security Checklist

- [x] Rate limiting on incident creation (configured in middleware)
- [x] Database encryption at rest (SQLite FTS disabled for safety)
- [x] CSRF tokens on all forms
- [x] HTTPOnly cookies
- [x] Incident data isolation (no user-agent leakage)
- [x] Docker socket isolation (only if Windlass is trusted)
- [ ] TLS for inter-service communication (Windlass ↔ StdOut)
- [ ] Audit logging for incident modifications

## Known Limitations

- Windlass requires Docker socket mounted as rw (potential privilege escalation if untrusted containers run)
- Observatory requires 16GB+ RAM for Ollama models
- Ticketing integrations are framework only; implementations TBD
- Incident exports are JSON only (no PDF reports yet)
- Multi-tenant mode (STDOUT_MODE=saas) not production-ready

## Troubleshooting

**Windlass services not showing up:** Verify `/opt/windlass/schedule.yaml` exists and has correct `compose_path` (full directory, not file). Run `docker ps --format '{{.Names}}'` to get actual container names.

**Windlass start/stop failing silently:** Check Docker socket mounted as `:rw` not `:ro`. Without write access, commands appear to work but don't execute.

**Cron times off by hours:** Windlass cron times are always UTC; convert from America/Chicago before writing. Check `/status.json` → `upcoming_events` to verify.

**Observatory alerts not creating incidents:** Ensure Ollama is running on host and models are pulled (`ollama pull llama3.2:3b-instruct-q4_K_M`).

**Database locked:** Kill existing processes; remove `.db-wal` and `.db-shm` files if stuck.

## Testing

Full test suite in `tests/playwright.config.ts`:
- `test:smoke` — Quick smoke test
- `test:auth` — Authentication flow
- `test:security` — Security protections
- `test:ratelimit` — Rate limit behavior
- `test:no-ratelimit` — All tests except rate limit (faster)

Disable rate limit in tests via `STDOUT_DISABLE_RATE_LIMIT=1`.
