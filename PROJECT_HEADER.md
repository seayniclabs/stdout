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

## Last Decisions

- **Ticketing integration:** Framework added for external ticket connectors (Jira, GitHub, Zendesk) — wired via scheduler pattern, shipped 2026-06-08
- **Observatory dashboard:** Transformed to dark glassmorphism NOC style (2026-06-08)
- **Three-tier deployment:** StdOut only (core), StdOut + Windlass (schedule-aware), StdOut + Observatory (proactive monitoring with LLMs)
- **Windlass management:** Moved to optional profile; users choose based on schedule needs, Docker socket must be rw

## Next Steps

- Complete ticketing connector implementations (Jira, GitHub Issues)
- Observatory automated incident creation from CRITICAL alerts
- Multi-tenant SaaS mode (STDOUT_MODE=saas)
- Incident export/archive workflows

## Resource Inventory

| Component | Port | Type | Tech |
|-----------|------|------|------|
| **StdOut Core** | 8112 | Astro SSR | Astro 5.17, Node 22, better-sqlite3 |
| **Windlass** | 8116 | Schedule manager | Node.js, Docker API, cron evaluation |
| **Observatory** | 8080 | Monitoring | Prometheus, Loki, Tempo, Ollama |
| **Database** | (local) | SQLite | Drizzle ORM, WAL mode |
| **Storage** | (data/) | Filesystem | incidents.db, knowledge base, logs |
| **Network** | Tunnel | Cloudflare | seaynicroute.com → container:8112 |

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
