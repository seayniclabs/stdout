# StdOut

AI-assisted incident companion for self-hosters and solo developers. Turns your past fixes into future answers — a living runbook that knows your stack.

**License**: Personal use only. Commercial use requires a license. See [LICENSE](LICENSE) for details.

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
- ✅ Windlass auto-connects if available
- ✅ Ticketing system auto-detected from env vars (or uses built-in)
- ✅ License is optional (activate later in Settings)
- ✅ No manual configuration required

The setup wizard completes in **2 steps** instead of 8. No decisions, no "Skip for Now" buttons.

---

## Architecture

StdOut is one Docker container with three optional components:

1. **StdOut Core** (port 8112) - Incident companion, dashboard, AI diagnostics, knowledge base
2. **Windlass** (port 8116) - Schedule-aware Docker service manager *(optional)*
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
│  Schedule-aware Docker service manager  │
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

## Windlass — Do You Need It?

Windlass is a schedule-aware Docker service manager. It reads a `schedule.yaml` and automatically starts, stops, and monitors your Docker Compose stacks. StdOut connects to it over HTTP and uses it to:

- Show schedule-aware service status (running vs. stopped vs. should-be-running)
- Alert only when a service is unexpectedly down (not when it's scheduled to be off)
- Send start/stop/restart commands from the StdOut dashboard
- Execute auto-fix plan steps directly on the host

**You want Windlass if you:**
- Have Docker Compose stacks you want started/stopped on a schedule (e.g., a social scheduler that runs overnight, a dev environment that shouldn't run 24/7)
- Want StdOut to alert you when a service is down *unexpectedly*, not just *down*
- Want to control services from the StdOut dashboard instead of SSH
- Use StdOut's auto-fix feature and want commands to actually run on the host

**You do NOT need Windlass if you:**
- Just want incident tracking, AI diagnostics, and a knowledge base
- Run all your services 24/7 and don't need schedule management
- Are evaluating StdOut for the first time

---

## Starting with Windlass

### Step 1: Create your config directory

```bash
sudo mkdir -p /opt/windlass
```

### Step 2: Write your schedule

```bash
curl -o /opt/windlass/schedule.yaml \
  https://raw.githubusercontent.com/seayniclabs/windlass/main/schedule.yaml.example
```

Edit `/opt/windlass/schedule.yaml` to match your actual services. See [Windlass docs](https://github.com/seayniclabs/windlass) for the full format.

### Step 3: Mount your compose directories

Open `docker-compose.yml` and uncomment the volume mount under the `windlass` service:

```yaml
volumes:
  - /opt/windlass:/opt/windlass
  - /var/run/docker.sock:/var/run/docker.sock
  - /opt/containers:/opt/containers  # ← add your actual compose root
```

### Step 4: Start both services

```bash
docker compose --profile windlass up -d
```

This starts both `stdout` (port 8112) and `windlass` (port 8116).

### Step 5: Connect StdOut to Windlass

1. Open StdOut → **Windlass** in the nav
2. Enter `http://host.docker.internal:8116` as the endpoint URL
3. Click **Connect**
4. Click **Sync** to pull in your service registry

StdOut will now show your services, their schedule windows, and alert when something is down outside its expected window.

---

## Windlass Deployment Notes

Three things that trip up new Windlass deployments.

### schedule.yaml — compose_path and container names

`compose_path` must be the **absolute path to the directory containing `docker-compose.yml`** — not the file itself.

```yaml
# Correct
services:
  my-service:
    compose_path: /opt/containers/my-service

# Wrong — points to the file
    compose_path: /opt/containers/my-service/docker-compose.yml
```

The `containers` list takes **actual Docker container names** as shown in `docker ps`, not Compose service names. If you don't pin container names with `container_name:` in your compose file, Docker generates names like `my-service-app-1`. Run `docker ps --format '{{.Names}}'` to confirm names before filling in `schedule.yaml`.

```yaml
services:
  postiz:
    compose_path: /opt/containers/postiz
    containers: [postiz-app, postiz-worker, postiz-postgres, postiz-redis]
    type: schedule
    cron_start: "0 4 * * *"   # UTC — see note below
    cron_stop:  "0 10 * * *"
```

### Docker socket must be mounted :rw

Windlass needs read-write access to the Docker socket to start and stop containers. The default mount (no mode flag) is read-write and is correct. The `:ro` flag breaks container control.

```yaml
# Correct — rw is the default
- /var/run/docker.sock:/var/run/docker.sock

# Wrong — breaks start/stop
- /var/run/docker.sock:/var/run/docker.sock:ro
```

With `:ro`, Windlass will connect and report status correctly, but all start/stop/restart operations will fail silently. Services will appear managed but will not actually be controlled.

### Cron times are always UTC

`cron_start` and `cron_stop` are evaluated in UTC regardless of the `TZ` environment variable. Setting `TZ=America/Chicago` adjusts log timestamps only — it does not shift when schedule windows fire.

Convert your intended local time to UTC before writing cron expressions:

| Intent (America/Chicago) | cron value (UTC) |
|--------------------------|------------------|
| 11 PM CT in winter (CST, UTC−6) | `0 5 * * *` |
| 11 PM CT in summer (CDT, UTC−5) | `0 4 * * *` |
| 4 AM CT in winter | `0 10 * * *` |
| 4 AM CT in summer | `0 9 * * *` |

After deploying, verify by checking `/status.json` → `upcoming_events` — the next scheduled window should reflect your expected UTC time.

---

## Starting without Windlass

```bash
docker compose up -d
```

Just StdOut. Windlass is not started. You can add it later at any time.

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

## Links

- [Windlass engine](https://github.com/seayniclabs/windlass) — separate repo, full format reference
- [StdOut docs](https://seayniclabs.com/stdout) — guides, API reference, self-host walkthrough

---

## Observatory — Proactive Monitoring (Optional)

Observatory adds **proactive monitoring** with AI-powered detection and diagnosis. While StdOut helps you fix incidents after they happen, Observatory tries to catch them before they become problems.

### What Observatory Does

- 🔍 **Active monitoring** - Continuously watches all your services
- 🤖 **AI detection** - Llama 3.2 3B watches for anomalies every 5-60 minutes
- 🧠 **AI diagnosis** - Qwen 2.5 14B analyzes root causes when issues are found
- 📊 **Full observability** - Prometheus (metrics), Loki (logs), Tempo (traces)
- 🎯 **Auto-incident creation** - Creates StdOut incidents automatically for critical issues

### When You Want Observatory

**Use Observatory if you:**
- Monitor 10+ services and want proactive alerts
- Need metrics/logs/traces in one place
- Want AI to catch issues before users notice
- Run critical services that can't have downtime
- Like dashboards with graphs and real-time data

**Skip Observatory if you:**
- Just want incident tracking after problems happen
- Have < 5 services and manual checks are fine
- Don't want to run Ollama + LLM models locally
- Prefer external monitoring (Datadog, New Relic, etc.)

### Requirements

- **Ollama** must be installed and running (for LLM models)
- **16GB+ RAM** recommended (models use ~6GB)
- **GPU optional** but makes LLM inference much faster

### Starting with Observatory

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

### Configuration

All Observatory settings are in `.env`:

```bash
# Ollama host
OLLAMA_HOST=http://host.docker.internal:11434

# LLM models (change if you want different models)
WATCHER_MODEL=llama3.2:3b-instruct-q4_K_M
ANALYST_MODEL=qwen2.5:14b-instruct-q4_K_M

# Check intervals (seconds)
CRITICAL_CHECK_INTERVAL=300      # 5 min for critical services
PRODUCT_CHECK_INTERVAL=600       # 10 min for product services
DEFAULT_CHECK_INTERVAL=3600      # 60 min for everything else

# Alert channels
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
HELMSMAN_API_URL=http://your-helmsman-api
```

### Monitoring Your Services

Observatory auto-discovers Docker containers. To monitor external services:

1. Add them to `observatory/config/prometheus.yml`
2. Restart Observatory: `docker compose --profile observatory restart prometheus`

Example:

```yaml
scrape_configs:
  - job_name: 'my-api'
    static_configs:
      - targets: ['api.example.com:9090']
```

### Stopping Observatory

```bash
# Stop Observatory only (keeps StdOut running)
docker compose --profile observatory down

# Or stop everything
docker compose down
```

---
