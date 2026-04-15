# StdOut

AI-assisted incident companion for self-hosters and solo developers. Turns your past fixes into future answers — a living runbook that knows your stack.

## Quick Start

```bash
mkdir stdout && cd stdout

# Download the compose file
curl -o docker-compose.yml https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.yml

# Start StdOut
docker compose up -d
```

Open `http://localhost:8112` to get started.

---

## Architecture

StdOut is one Docker container. It includes the web UI, API, AI diagnostic engine, scanner, HUD, and knowledge base — everything runs in a single image.

**Windlass is a separate, optional component.** It is not required to use StdOut.

```
┌─────────────────────────────────────────┐
│           StdOut  (port 3000)            │
│  Dashboard · Incidents · HUD · KB · AI  │
└─────────────────┬───────────────────────┘
                  │  optional HTTP poll
                  ▼
┌─────────────────────────────────────────┐
│         Windlass Engine  (port 8116)     │
│  Schedule-aware Docker service manager  │
│  Runs on your host, manages containers  │
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
