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

## Assessment — 2026-06-10

### Errors & Risks
[HIGH] Windlass Docker socket mounted as rw — privilege escalation if untrusted containers run; no isolation between StdOut + container orchestration
[HIGH] Observatory Ollama dependency (16GB+ RAM) — steep system requirement; no fallback if Ollama unavailable; memory OOM silent failure
[MED] Rate limiting implementation unclear — tests toggle STDOUT_DISABLE_RATE_LIMIT=1, but production fallback (when limit breached) not documented; possible silent accepts
[MED] Ticketing framework wired but implementations TBD — Jira/GitHub/Zendesk connectors stubbed; auto-ticket creation broken until wired
[LOW] Test encryption key hardcoded (STDOUT_ENCRYPTION_KEY=test_key_for_playwright) — Playwright tests use fake key; production key different; no integration test with real key

### Security
[PASS] CSRF tokens, HTTPOnly cookies, rate limiting on incident creation (framework in middleware)
[WARN] Docker socket isolation — mounting as rw breaks container boundary; needs documentation + warning
[PASS] Incident data isolation (no user-agent leakage per PROJECT_HEADER)
[FAIL] TLS for Windlass ↔ StdOut communication missing — internal HTTP, no encryption between components if deployed on public network

### Improvements
Add Ollama availability check on startup; fall back to text-only mode if unavailable (degrade gracefully)
Document + enforce rate limit behavior — clarify silent accept vs circuit breaker vs error response
Wire Jira/GitHub/Zendesk connectors; auto-create tickets from incidents (Phase 2)
Add TLS between Windlass ↔ StdOut (mTLS with self-signed certs); document Docker socket security requirements
Implement incident export to PDF/JSON with customer audit trail

### Cost
Ollama 16GB requirement expensive — consider tiered model sizes (7B fallback if 14B OOM)
Self-hosted Observatory (Prometheus+Loki+Tempo) efficient for on-prem deployments

### Performance
Astro SSR + better-sqlite3 fast; Drizzle ORM queries lean
Windlass cron evaluation UTC-only (not local time) — users report confusion; consider tz-aware cron
Docker API calls via Windlass scale linear with container count

### Verdict
**Grade: B-** — Self-hosted incident companion solid but incomplete. Observatory/Windlass wired but risky (Docker socket, Ollama memory). Rate limiting untested. Ticketing framework stubbed. Fix: Ollama fallback, enforce TLS, wire ticketing integrations, document rate-limit behavior.

**Last Updated:** 2026-06-10

## Last Decisions

- **Ticketing integration:** Framework added for external ticket connectors (Jira, GitHub, Zendesk) — wired via scheduler pattern, shipped 2026-06-08
- **Observatory dashboard:** Transformed to dark glassmorphism NOC style (2026-06-08)
- **Three-tier deployment:** StdOut only (core), StdOut + Windlass (schedule-aware), StdOut + Observatory (proactive monitoring with LLMs)
- **Windlass management:** Moved to optional profile; users choose based on schedule needs, Docker socket must be rw

## Current State

StdOut is a production incident companion for self-hosters and solo developers, live at https://stdout.seayniclabs.com. Latest commit (34b65e6) fixes Docker network filtering in container IP scan. Clean repository (no uncommitted changes). Three-component architecture: Core (8112) for incident tracking + AI diagnostics, Windlass (8116) for schedule-aware Docker management, Observatory (8080) for proactive monitoring with Llama 3.2 + Qwen 2.5 analysis. Built with Astro, deployed via Docker; public GitHub repo with personal-use license. Recent work: ticketing framework (Jira/GitHub/Zendesk), glassmorphism Observatory dashboard, optional profile management.

## Next Steps

1. **[Priority: High]** Complete ticketing integrations — wire Jira, GitHub Issues, Zendesk connectors; auto-create tickets from StdOut incidents.

2. **[Priority: Med]** Observatory auto-escalation — auto-create incidents from CRITICAL Observatory alerts; auto-assign to on-call based on schedule (Windlass).

3. **[Priority: Med]** Multi-tenant SaaS mode — implement STDOUT_MODE=saas with organization isolation, team billing, and white-label options.
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
