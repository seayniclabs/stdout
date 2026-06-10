# Monitoring StdOut Installation Progress

This guide shows how to monitor the automated installation process when deploying StdOut for the first time.

## Overview

StdOut includes a fully automated installer that runs on first launch. The installation process includes:

1. **Database Initialization** — Schema creation and pattern seeding
2. **Scanner Setup** — API token generation
3. **Windlass Installation** — Monitoring engine container (optional)
4. **Observatory Setup** — Ollama + ML models (optional)
5. **Data Source Discovery** — Auto-detect monitoring tools
6. **Monitor Configuration** — Create default monitors
7. **Health Verification** — Verify all components operational

## Web UI Monitoring

**The easiest way to monitor installation is through the web interface:**

1. Navigate to your StdOut instance (e.g., `http://localhost:8112`)
2. Register/login with any email
3. You will be automatically redirected to `/app/setup`
4. Click **"Start Installation"**

The UI shows:
- **Overall progress bar** with percentage and ETA
- **Per-step status cards** (pending → running → complete)
- **Live console output** with timestamps
- **Warnings and errors** inline

## Command-Line Monitoring

### Via Server-Sent Events (SSE)

The installation progress is streamed via Server-Sent Events. You can monitor it with `curl`:

```bash
# Get your session cookie first (from browser DevTools → Application → Cookies)
SESSION_COOKIE="your-session-cookie-value"

# Watch the installation stream
curl -N http://localhost:8112/app/api/setup/install-stream \
  -H "Cookie: sl_session=${SESSION_COOKIE}"
```

**Example output:**
```
event: state
data: {"steps":[{"id":"database","status":"running","progress":30,"eta":7000,...}],...}

event: event
data: {"type":"step_progress","stepId":"database","message":"Creating schema...","progress":50}

event: state
data: {"steps":[{"id":"database","status":"complete","progress":100,...}],...}
```

### Via Docker Logs

You can also monitor Docker logs during installation:

```bash
# Follow live logs
docker logs -f stdout

# Watch for installation-related messages
docker logs stdout | grep -E "(Setup|installation|Observatory)"
```

**Key log patterns to watch for:**

```
[Setup] First run detected - database does not exist
[Setup] First run detected - installation incomplete
[Setup] Installation complete
[Observatory] Initialized successfully
[Observatory] Mode: full_init | Ready: true
```

## Monitoring Specific Steps

### Database Initialization

**What it does:**
- Creates SQLite databases (central + tenant)
- Seeds Observatory standard patterns (32 patterns)
- Creates default preferences

**Expected duration:** ~10 seconds

**Success indicators:**
- No SQLite errors in logs
- Database files exist: `/data/stdout-central.db`, `/data/stdout.db`

**Verify:**
```bash
docker exec stdout sqlite3 /data/stdout-central.db "SELECT COUNT(*) FROM observatory_standard_patterns;"
# Should return: 32
```

### Scanner Setup

**What it does:**
- Generates API token for scanner
- Prepares scanner command

**Expected duration:** ~30 seconds

**Success indicators:**
- API token created
- Scanner command displayed in logs

### Windlass Installation (Optional)

**What it does:**
- Pulls Windlass Docker image
- Starts container on port 8116

**Expected duration:** ~60 seconds

**Success indicators:**
- Container `windlass` is running
- Health check passing

**Verify:**
```bash
docker ps | grep windlass
curl -I http://localhost:8116/health
```

### Observatory Setup (Optional)

**What it does:**
- Installs Ollama (if not present)
- Downloads ML models:
  - Llama 3.2 3B (~2GB) for Watcher agent
  - Qwen 2.5 14B (~9GB) for Analyst agent

**Expected duration:** ~5 minutes (model downloads)

**Success indicators:**
- Ollama responding
- Models available

**Verify:**
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Check for models
docker exec stdout sh -c "curl -s http://localhost:11434/api/tags | grep llama3.2"
```

### Data Source Discovery

**What it does:**
- Scans running Docker containers
- Detects monitoring tools (Prometheus, InfluxDB, Grafana, etc.)
- Saves to `data_sources` table

**Expected duration:** ~15 seconds

**Success indicators:**
- Data sources discovered and saved

**Verify:**
```bash
docker exec stdout sqlite3 /data/stdout-central.db "SELECT type, name, url FROM data_sources;"
```

### Monitor Configuration

**What it does:**
- Creates default monitors for discovered stacks
- Monitors: health, CPU, memory, restart count

**Expected duration:** ~20 seconds

**Success indicators:**
- Monitors created for each stack

**Verify:**
```bash
docker exec stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM monitors;"
```

### Health Verification

**What it does:**
- Checks database connectivity
- Verifies Windlass responding
- Verifies Observatory ready

**Expected duration:** ~10 seconds

**Success indicators:**
- All components healthy
- No critical errors

**Verify:**
```bash
curl http://localhost:8112/healthz
# Should return: {"status":"ok"}
```

## Installation Complete

When installation finishes, the `system_state` table is updated:

```sql
INSERT INTO system_state (key, value, updated_at)
VALUES ('installation_complete', 'true', <timestamp>);
```

After this, the middleware stops redirecting to `/app/setup`.

## Troubleshooting

### Installation hangs on Observatory setup

**Cause:** Large model downloads (Qwen 2.5 14B is ~9GB)

**Solution:** Be patient — first-time model download takes 10-20 minutes on slow connections. Watch Docker logs:

```bash
docker logs -f stdout | grep -i "model"
```

### Installation fails with permission errors

**Cause:** Docker permissions or volume mount issues

**Solution:**
```bash
# Ensure data directory is writable
sudo chown -R 1000:1000 ./data
sudo chmod -R 755 ./data
```

### "Skip Optional Components" doesn't work

**Cause:** UI not wired yet (future enhancement)

**Current workaround:** Edit `src/pages/app/api/setup/install-stream.ts` and change:

```typescript
const skipWindlass = true;
const skipObservatory = true;
```

## Next Steps

After installation completes:

1. **Run the scanner** to discover your infrastructure
2. **Configure data sources** manually if auto-discovery missed any
3. **Review monitors** in Settings → Monitors
4. **Check Observatory** status at `/app/observatory`

## Monitoring After Installation

Once installed, StdOut provides several monitoring endpoints:

- **Health check:** `GET /healthz`
- **Metrics:** `GET /app/api/metrics`
- **Observatory runs:** `GET /app/api/observatory/runs`
- **Docker health:** `docker compose ps`

See the [Operations Runbook](./runbook.md) for ongoing monitoring and maintenance.
