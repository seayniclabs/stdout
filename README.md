# StdOut

**Autonomous IT for SMB ops teams.** Your infrastructure assistant that learns your stack, remembers every fix, and handles the repetitive work so your team can focus on what matters.

**License**: Personal use only. Commercial use requires a license. See [LICENSE](LICENSE) for details.

---

## What StdOut Does

StdOut is an autonomous IT assistant for small business operations teams. It:

- **Learns your infrastructure** — Auto-discovers Docker containers, network devices, services, and dependencies
- **Remembers every fix** — Builds a living knowledge base from your incident resolutions
- **Handles routine work** — Monitors services, creates incidents automatically, suggests fixes based on your history
- **Keeps your team aligned** — Shared runbooks, incident tracking, and operational documentation in one place

Stop solving the same problem twice. Stop losing knowledge when team members leave. Stop paying enterprise prices for tools built for 500-person companies.

---

## Quick Start

```bash
mkdir stdout && cd stdout

curl -o docker-compose.yml https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.yml
curl -o .env.example https://raw.githubusercontent.com/seayniclabs/stdout/main/.env.example
cp .env.example .env
# Edit .env: set APP_URL and SECRET_KEY (32+ random characters)

docker compose up -d
```

Open `APP_URL` (default `http://localhost:8112`), create your admin account, name your environment, and you're done. Everything else is **fully automated**:

- ✅ Network scanning runs in background
- ✅ Service discovery auto-connects
- ✅ Ticketing system auto-detected from env vars (or uses built-in)
- ✅ License is optional (activate later in Settings)
- ✅ No manual configuration required

Setup completes in **2 steps** instead of 8. No decisions, no "Skip for Now" buttons.

---

## Architecture

StdOut is one Docker container with three optional components:

1. **StdOut Core** (port 8112) - Incident management, dashboard, AI diagnostics, knowledge base
2. **Windlass** (port 8116) - Schedule-aware service manager *(optional)*
3. **Observatory** (port 8080) - Proactive monitoring with AI agents *(optional)*

```
┌─────────────────────────────────────────┐
│           StdOut  (port 8112)            │
│  Dashboard · Incidents · HUD · KB · AI  │
└─────────────────┬───────────────────────┘
                  │  optional HTTP poll
                  ▼
┌─────────────────────────────────────────┐
│         Windlass Engine  (port 8116)     │
│  Schedule-aware service manager          │
│  Runs on your host, manages containers  │
└─────────────────────────────────────────┘
                  │  auto-creates incidents
                  ▼
┌─────────────────────────────────────────┐
│      Observatory Monitor  (port 8080)    │
│  Watcher (3B) + Analyst (14B) AI agents │
│  Prometheus · Loki · Tempo observability│
└─────────────────────────────────────────┘
```

---

## Who This Is For

**You're a good fit if:**
- You're a 2-15 person ops/IT team at a small business
- You manage 10-100+ services across Docker, VMs, or bare metal
- You're tired of losing knowledge when team members leave
- You want incident management without paying $50/user/month
- You need shared runbooks that actually stay up to date
- You want AI assistance trained on *your* infrastructure, not generic answers

**You're NOT a good fit if:**
- You're a solo hobbyist (StdOut works, but it's built for teams)
- You have 50+ person IT org (you need enterprise tooling)
- You want a SaaS-only solution (we offer cloud, but self-hosted is the default)
- You don't want to self-host anything

---

## Core Features

### 1. Infrastructure Discovery
Auto-discovers your entire stack in minutes:
- Docker containers, compose projects, networks, volumes
- Network devices via SNMP (switches, APs, routers)
- TLS certificates with expiration tracking
- Service dependencies and exposed ports

One command maps everything. No manual inventory maintenance.

### 2. Incident Management
Built-in ticketing system that actually works for ops teams:
- Create incidents in 30 seconds (paste error, tag severity, done)
- AI matches against your resolution history automatically
- Shared incident view — everyone sees the same context
- Auto-creates incidents from monitoring alerts
- Links to runbooks, past fixes, and related services

### 3. AI Diagnosis
Claude analyzes incidents against *your specific stack*:
- Ranked root causes based on your infrastructure
- Commands to run, logs to check, services to restart
- Learns from your past resolutions
- Not generic — trained on your environment

### 4. Knowledge Base
Turn every fix into documentation:
- Runbook pages auto-generated from incident resolutions
- Full-text search across all documentation
- Markdown support with code blocks
- Version history for all pages
- Shared across your team

### 5. Service Monitoring
HUD dashboard shows real-time service health:
- Uptime monitoring for every discovered service
- Auto-creates incidents on downtime
- Schedule-aware (doesn't alert when services are supposed to be down)
- Public status page for your users

### 6. Team Collaboration
Built for teams, not individuals:
- Role-based access control (admin, operator, viewer)
- Shared incident queue
- Weekly digest emails
- Slack/Teams integration
- Audit log for all changes

---

## Windlass — Schedule-Aware Service Management

Windlass is an optional component that adds schedule-aware service management. It reads a `schedule.yaml` and automatically starts, stops, and monitors your Docker Compose stacks.

**You want Windlass if you:**
- Have services that run on schedules (batch jobs, dev environments, etc.)
- Want StdOut to alert only when services are *unexpectedly* down
- Want to control services from the StdOut dashboard
- Use StdOut's auto-fix feature and want commands to run on the host

**You do NOT need Windlass if you:**
- Run all services 24/7
- Just want incident tracking and knowledge base
- Are evaluating StdOut for the first time

See [Windlass docs](https://github.com/seayniclabs/windlass) for setup instructions.

---

## Observatory — Proactive Monitoring

Observatory adds AI-powered proactive monitoring with Prometheus, Loki, and Tempo.

**You want Observatory if you:**
- Monitor 10+ services and want proactive alerts
- Need metrics/logs/traces in one place
- Want AI to catch issues before users notice
- Run critical services that can't have downtime

**Skip Observatory if you:**
- Just want incident tracking after problems happen
- Have < 5 services and manual checks are fine
- Don't want to run Ollama + LLM models locally
- Prefer external monitoring (Datadog, New Relic, etc.)

See Observatory section below for setup instructions.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STDOUT_MODE` | `selfhost` | Set to `saas` for multi-tenant mode |
| `DB_PATH` | `./data/stdout.db` | SQLite database location |
| `TZ` | `UTC` | Container timezone |
| `ANTHROPIC_API_KEY` | — | Optional platform AI key (users can also bring their own) |
| `RESEND_API_KEY` | — | Email notifications |
| `WINDLASS_URL` | `http://host.docker.internal:8116` | Windlass engine URL (auto-populated if using the compose profile) |

---

## Updating

```bash
docker compose pull
docker compose up -d           # StdOut only
# or
docker compose --profile windlass up -d   # StdOut + Windlass
```

## Backups

Back up the `./data/` directory. The SQLite database supports online backups — safe to copy while StdOut is running (WAL mode).

---

## Pricing

### Self-Hosted (Recommended)
**$149 one-time** — Deploy on your infrastructure, own it forever.
- Everything included, no feature gates
- Unlimited users, stacks, incidents
- Your data stays on your network
- No subscription, ever

### Cloud Plans
For teams who prefer managed hosting:

**Solo** — $12/month
- 1 user, 1 stack, 100 incidents/month
- 1GB knowledge base storage
- Good for individual ops engineers

**Shop** — $24/month
- 5 users, 3 stacks, unlimited incidents
- 10GB knowledge base storage
- RBAC, Slack integration, audit log
- Good for small ops teams

**Enterprise** — Custom pricing
- Unlimited everything
- SSO, custom integrations, SLA
- Dedicated support

[View pricing details →](https://store.seayniclabs.com/products/stdout)

---

## Links

- [Windlass engine](https://github.com/seayniclabs/windlass) — separate repo, full format reference
- [StdOut docs](https://seayniclabs.com/stdout) — guides, API reference, self-host walkthrough
- [Use cases](https://seayniclabs.com/stdout/use-cases) — see how teams use StdOut

---

## Observatory Setup (Optional)

Observatory adds **proactive monitoring** with AI-powered detection and diagnosis.

### Requirements

- **Ollama** must be installed and running (for LLM models)
- **16GB+ RAM** recommended (models use ~6GB)
- **GPU optional** but makes LLM inference much faster

### Setup

#### Step 1: Install Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the models
ollama pull llama3.2:3b-instruct-q4_K_M
ollama pull qwen2.5:14b-instruct-q4_K_M
```

#### Step 2: Enable Observatory profile

```bash
# Edit .env and add Observatory config (see .env.example)
nano .env

# Start with Observatory profile
docker compose --profile observatory up -d
```

#### Step 3: Access dashboards

- **Observatory**: http://localhost:8080
- **Prometheus**: http://localhost:9090
- **StdOut** (main): http://localhost:8112

### How It Works

1. **Watcher Agent** (Llama 3.2 3B) runs every 5-60 minutes
   - Queries Prometheus for service health
   - Detects anomalies (services down, high CPU, memory spikes)
   - Broadcasts alerts via WebSocket

2. **Analyst Agent** (Qwen 2.5 14B) triggers on HIGH/CRITICAL alerts
   - Fetches logs from Loki
   - Fetches traces from Tempo
   - Diagnoses root cause
   - Recommends fixes

3. **Auto-incident creation**
   - CRITICAL alerts → StdOut incident created automatically
   - Includes diagnosis, logs, and recommended fix
   - Links back to Observatory traces/metrics

---

## Development

### Prerequisites

- Node.js 18+ (20+ recommended)
- npm 9+
- SQLite 3.35+

### Setup

```bash
# Clone the repo
git clone https://github.com/seayniclabs/stdout.git
cd stdout

# Install dependencies
npm install

# Run database migrations (REQUIRED before dev server)
npm run db:migrate

# Start dev server
npm run dev
```

**Important:** Migrations must run before starting the dev server. The application verifies migrations have been applied and will throw an error if the database is not initialized.

### Available Scripts

```bash
npm run dev            # Start Astro dev server (localhost:4321)
npm run build          # Build for production
npm run preview        # Preview production build
npm run db:migrate     # Run database migrations
npm run db:studio      # Open Drizzle Studio (database GUI)
npm run test:smoke     # Run smoke tests (6 critical paths)
npm run test:security  # Run security tests
```

### Database Migrations

StdOut uses Drizzle ORM with SQLite. **Never** skip migrations:

1. **First-time setup:** `npm run db:migrate`
2. **After pulling changes:** `npm run db:migrate`
3. **Before tests:** Migrations run automatically via `test:setup`

The dev server verifies migrations have run and will exit with an error if the `__drizzle_migrations` table is missing.

### Testing

```bash
# Smoke tests (6 critical user paths)
npm run test:smoke

# Security tests (OWASP checks, CVE scans)
npm run test:security

# Individual test files
npx playwright test tests/smoke.spec.ts
```

Tests create a temporary database at `./data/stdout.db` with seeded test data. The `test:setup` script runs migrations automatically.

---

## Support

- **Documentation**: [seayniclabs.com/stdout](https://seayniclabs.com/stdout)
- **Email**: hello@seayniclabs.com
- **GitHub Issues**: [github.com/seayniclabs/stdout/issues](https://github.com/seayniclabs/stdout/issues)

---

## License

Personal use only. Commercial use requires a license. See [LICENSE](LICENSE) for details.

Built by [Seaynic Labs LLC](https://seayniclabs.com).
