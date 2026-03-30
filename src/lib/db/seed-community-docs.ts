/**
 * Community Knowledge Base — Seed Documents
 *
 * Pre-sanitized operational docs that ship with every StdOut instance.
 * These establish the quality bar and format standard for community contributions.
 * All PII, hostnames, and org-specific details have been stripped.
 */

export interface SeedDoc {
  id: string;
  title: string;
  content: string;
  docType: 'runbook' | 'postmortem' | 'guide' | 'note';
  tags: string;
}

export const SEED_VERSION = 3;

export const seedDocs: SeedDoc[] = [
  // ── Getting Started Onboarding Guides ──────────────────────────────
  {
    id: 'community_onboarding_001',
    title: 'Getting Started with StdOut',
    content: `## What Is StdOut?

StdOut is an AI-assisted incident companion for self-hosters and solo developers. It turns your past fixes into future answers — a living runbook that knows your stack.

## The Core Workflow

Every interaction in StdOut follows a four-step loop:

1. **Detect** — The scanner discovers your containers, networks, and services. The HUD monitors them for health changes.
2. **Diagnose** — When something breaks, AI analyzes the incident against your stack context and suggests root causes.
3. **Resolve** — You log what actually fixed it. Resolutions are saved with full context.
4. **Learn** — Next time a similar issue appears, StdOut surfaces your past resolutions automatically. Your knowledge compounds.

## The Five Main Areas

| Area | What It Does |
|------|-------------|
| **Dashboard** | At-a-glance view of your infrastructure — service health gauges, recent incidents, and import status |
| **Incidents** | Create, diagnose, and resolve incidents. AI matches similar past fixes automatically |
| **HUD** | Real-time health monitoring with HTTP/TCP checks, sparklines, uptime calendars, and auto-incident creation |
| **Stacks** | Your infrastructure inventory — containers, services, and their relationships grouped by stack |
| **Knowledge Base** | Runbooks, postmortems, guides, and notes. Community docs ship out of the box; yours grow over time |

## What to Set Up First

1. **Name your workspace** — give it an identity (Settings > Workspace)
2. **Generate an API token** — needed for the scanner (Settings > API Tokens)
3. **Run the scanner** — discover your infrastructure automatically
4. **Set up notifications** — know when something goes down (Settings > Notifications)

Each of these steps has its own guide in this Knowledge Base. Start with "Set Up Your Workspace" next.`,
    docType: 'guide',
    tags: 'stdout,getting-started,onboarding',
  },
  {
    id: 'community_onboarding_002',
    title: 'Set Up Your Workspace',
    content: `## Overview

Your workspace is your StdOut identity. It controls the name, accent color, and logo that appear throughout the interface. Setting this up first makes StdOut feel like yours.

## Find the Settings

1. Click the **gear icon** in the top navigation bar
2. Select **Settings**
3. You'll land on the **Workspace** section

## Name Your Workspace

The workspace name appears in the navigation bar and on your public status page (if enabled). Pick something that identifies your environment:

- \`homelab\` — for a single home server
- \`production\` — for a live deployment
- Your server's hostname — e.g., \`mini-m4\`, \`nuc-01\`

Type the name in the **Workspace Name** field and click **Save**.

## Set Your Accent Color

The accent color controls buttons, links, active states, and highlights throughout the UI. Click the color picker next to **Accent Color** to choose your color. The change previews immediately.

Good defaults:
- **Coral** (\`#F97316\`) — the StdOut default, high visibility
- **Teal** (\`#14B8A6\`) — calmer, good for always-on dashboards
- **Indigo** (\`#6366F1\`) — if you prefer cooler tones

## Upload a Logo

The logo appears in the top-left of the navigation bar, replacing the default StdOut icon. Upload a square PNG or SVG, ideally at least 128x128px. Transparent backgrounds work best against the dark UI.

1. Click **Choose File** under Logo
2. Select your image
3. Click **Save**

## What's Next

With your workspace configured, move on to **Configure Email and Webhook Alerts** to set up notifications.`,
    docType: 'guide',
    tags: 'stdout,getting-started,setup,workspace',
  },
  {
    id: 'community_onboarding_003',
    title: 'Configure Email and Webhook Alerts',
    content: `## Overview

Notifications tell you when something needs attention — a service went down, an incident was created, or your weekly digest is ready. StdOut supports email and webhook notifications.

## Find Notification Settings

1. Click the **gear icon** in the top navigation bar
2. Select **Settings**
3. Click the **Notifications** tab

## Email Notifications

Email is the simplest notification channel. Enable it by toggling **Email Notifications** on.

**What triggers an email:**
- A monitored service goes **down** (health check failure)
- A monitored service **recovers** (health check passes after being down)
- An incident is **auto-created** by the HUD
- Your **weekly digest** is ready (summary of incidents, uptime, and patterns)

Emails go to your account email address. Make sure it's correct in **Settings > Account**.

## Webhook Notifications

Webhooks send a JSON payload to any URL you specify — perfect for Slack, Discord, Microsoft Teams, or custom automation.

### Setup

1. Enter your webhook URL in the **Webhook URL** field
2. Click **Test Webhook** to verify delivery
3. Toggle **Webhook Notifications** on
4. Click **Save**

### Payload Format

\`\`\`json
{
  "event": "service_down",
  "service": "nginx-proxy",
  "stack": "infrastructure",
  "timestamp": "2026-03-24T14:30:00Z",
  "message": "HTTP check failed: connection refused on port 80"
}
\`\`\`

### Platform-Specific URLs

| Platform | Where to Get the URL |
|----------|---------------------|
| **Slack** | Apps > Incoming Webhooks > Add New Webhook |
| **Discord** | Server Settings > Integrations > Webhooks > New Webhook |
| **Teams** | Channel > Connectors > Incoming Webhook |

## What's Next

Set up your API token so you can run the scanner — see **Create an API Token for the Scanner**.`,
    docType: 'guide',
    tags: 'stdout,getting-started,notifications,email,webhook',
  },
  {
    id: 'community_onboarding_004',
    title: 'Create an API Token for the Scanner',
    content: `## Overview

The scanner needs an API token to authenticate with your StdOut instance. Tokens are scoped to your account and can be revoked at any time.

## Generate a Token

1. Click the **gear icon** in the top navigation bar
2. Select **Settings**
3. Click the **API Tokens** tab
4. Click **Generate New Token**
5. Give it a descriptive name — e.g., \`scanner-macmini\` or \`homelab-scanner\`
6. Click **Create**

## Copy and Save the Token

The token is displayed **once**. Copy it immediately and store it securely:

\`\`\`
stdout_tk_a1b2c3d4e5f6...
\`\`\`

**Storage options:**
- A password manager (Vaultwarden, 1Password, Bitwarden)
- A \`.env\` file on the host where the scanner will run
- A Docker secret or config file

If you lose the token, revoke it and generate a new one. There is no way to retrieve an existing token after creation.

## Token Permissions

Your API token grants the following access:

| Capability | Access |
|-----------|--------|
| Submit scan results | Yes |
| Read scanner schedule | Yes |
| Read stacks/incidents | No |
| Modify settings | No |
| Delete data | No |

Tokens are designed for machine-to-machine authentication. They cannot access the web UI or modify account settings.

## Revoking a Token

If a token is compromised or no longer needed:

1. Go to **Settings > API Tokens**
2. Find the token by name
3. Click **Revoke**
4. The token is immediately invalidated — any scanner using it will receive 401 errors

## What's Next

With your token ready, move on to **Install and Run the Scanner** to discover your infrastructure.`,
    docType: 'guide',
    tags: 'stdout,getting-started,api,tokens,security',
  },
  {
    id: 'community_onboarding_005',
    title: 'Install and Run the Scanner',
    content: `## Overview

The StdOut scanner is a Go-based Docker sidecar that discovers your containers, networks, metrics, and services. It reports what it finds back to your StdOut instance via the API.

## Prerequisites

- Docker installed and running
- An API token (see "Create an API Token for the Scanner")
- Your StdOut instance URL

## Interactive Setup

The fastest way to get started is the interactive \`init\` command:

\`\`\`bash
docker run -it --rm \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -v ~/.stdout:/data \\
  ghcr.io/charlieseay/stdout-scanner init
\`\`\`

This walks you through module selection, token configuration, and creates a config file at \`~/.stdout/scanner.yaml\`.

## Run Your First Scan

After init, run a full scan:

\`\`\`bash
docker run --rm --net=host \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -v ~/.stdout:/data \\
  ghcr.io/charlieseay/stdout-scanner scan --full
\`\`\`

The scanner discovers:
- **Containers** — names, images, ports, networks, health status, compose projects
- **Metrics** — CPU, memory, network I/O, and disk usage per container and host
- **Network devices** — hosts on your subnet via ICMP/TCP discovery
- **DNS** — reverse DNS, mDNS/Bonjour, reverse proxy detection, TLS certificates
- **Auth** — HTTP auth types (basic, bearer, form, SSO) on discovered services

## Import Results

After the scan completes, go to your StdOut **Dashboard**. You'll see an import banner showing the scan results. Click **Review Import** to:

1. See the list of discovered containers
2. Check/uncheck which ones to import
3. Assign them to a new or existing stack
4. Click **Save** to add them to your inventory

## Set Up Recurring Scans

Run the scanner as a persistent container with a schedule:

\`\`\`bash
docker run -d --name stdout-scanner \\
  --net=host \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -v ~/.stdout:/data \\
  ghcr.io/charlieseay/stdout-scanner scan \\
  --schedule daily --delta \\
  --token YOUR_TOKEN \\
  --url https://your-stdout-instance.com
\`\`\`

The \`--delta\` flag means only changes since the last scan are reported — added containers, removed services, changed configurations.

You can also control the schedule from the StdOut UI: **Settings > Scanner** lets you set the interval and modules without touching the container.

## What's Next

With your infrastructure discovered, move on to **Create and Diagnose Your First Incident**.`,
    docType: 'guide',
    tags: 'stdout,getting-started,scanner,docker,setup',
  },
  {
    id: 'community_onboarding_006',
    title: 'Create and Diagnose Your First Incident',
    content: `## Overview

Incidents are the core of StdOut. They capture what broke, why, and how you fixed it — building a knowledge base that makes you faster over time.

## Two Ways Incidents Get Created

### 1. Manually

Click **Incidents** in the navigation bar, then **New Incident**. Fill in:

- **Title** — a clear, searchable description (e.g., "Nginx 502 after Docker restart")
- **Stack** — which stack is affected (selected from your imported stacks)
- **Description** — what you observed, error messages, when it started
- **Severity** — info, warning, or critical

As you type the title and description, StdOut searches for **similar past resolutions** in real time. If something matches, it appears in a panel on the right — you may already have the answer.

### 2. Automatically from the HUD

When the HUD detects a monitored service has gone down (health check failures exceed the threshold), it creates an incident automatically. The incident is linked to the service and includes:

- The failing health check details
- When the failure was first detected
- The monitor's recent response history

You'll get a notification (if configured) and see the incident on your dashboard.

## AI Diagnosis

On any incident detail page, click **Diagnose with AI**. StdOut sends the incident context — title, description, stack information, and any error details — to Claude for analysis.

The AI returns:

- **Probable root cause** — based on the symptoms and your stack context
- **Suggested fix** — actionable steps to resolve the issue
- **Related patterns** — links to similar issues if they exist in your knowledge base

AI diagnosis is available on all tiers (Haiku on Free, Sonnet on paid tiers).

## Adding a Resolution

Once you've fixed the issue:

1. Click **Add Resolution** on the incident detail page
2. Describe **what you actually did** to fix it — the specific commands, config changes, or actions
3. Click **Save**

The resolution is now part of your knowledge base. Next time a similar incident appears, StdOut surfaces this resolution automatically via similarity matching.

## What's Next

Learn how to turn resolutions into reusable documentation — see **Create Your First Runbook**.`,
    docType: 'guide',
    tags: 'stdout,getting-started,incidents,ai,diagnosis',
  },
  {
    id: 'community_onboarding_007',
    title: 'Create Your First Runbook',
    content: `## Overview

The Knowledge Base is where your institutional memory lives. It starts with community docs (like this one) and grows with every incident you resolve. Runbooks are the most valuable doc type — step-by-step procedures you can follow at 2 AM when you're half awake.

## Document Types

| Type | When to Use |
|------|-------------|
| **Runbook** | Step-by-step procedure for a recurring task or known failure mode |
| **Postmortem** | After-action analysis of a significant incident |
| **Guide** | How-to for setup, configuration, or best practices |
| **Note** | Anything else — quick references, links, context |

## Create a Runbook from a Resolved Incident

The fastest way to create a runbook is from an incident you've already resolved:

1. Go to the resolved incident's detail page
2. Review the resolution you logged
3. Click **Incidents** > think about what general procedure this represents
4. Go to **Knowledge Base** > **New Document**
5. Set the type to **Runbook**

## Writing a Good Runbook

Structure your runbook with these sections:

\`\`\`markdown
## Pattern
What situation triggers this runbook? How do you recognize it?

## Symptoms
What do you see in logs, dashboards, or error messages?

## Steps
1. First, verify the symptom: \`command here\`
2. Check the root cause: \`command here\`
3. Apply the fix: \`command here\`
4. Verify recovery: \`command here\`

## Prevention
How to avoid this in the future.
\`\`\`

**Good runbook habits:**
- Include the exact commands — don't paraphrase
- Note which containers, services, or paths are involved
- Add expected output so you know the step worked
- Write it for future-you who has forgotten the context

## Tags

Tag your documents so they're discoverable. Use comma-separated tags:

- Stack names: \`nginx\`, \`docker\`, \`postgresql\`
- Categories: \`networking\`, \`backup\`, \`security\`
- Severity context: \`outage\`, \`degraded\`, \`maintenance\`

Tags power the sidebar filters and search. Consistent tagging makes your knowledge base navigable.

## Community Docs

StdOut ships with community-contributed docs covering common homelab patterns — Docker DNS issues, proxy chain debugging, SQLite tuning, backup strategies, and more. Browse them in the Knowledge Base under the community source filter.

Over time, your own docs will outnumber the community ones. That's the goal — a knowledge base that's specifically tuned to your infrastructure and your patterns.`,
    docType: 'guide',
    tags: 'stdout,getting-started,knowledge-base,runbook,docs',
  },
  // ── Operational Pattern Docs ───────────────────────────────────────
  {
    id: 'community_seed_001',
    title: 'Docker DNS Resolution Failures After Network Restart',
    content: `## Pattern
Containers lose DNS resolution after a host network restart or VPN reconnect. Services that were working fine suddenly can't resolve external hostnames.

## Symptoms
- Container logs show \`getaddrinfo ENOTFOUND\` or \`Temporary failure in name resolution\`
- \`docker exec <container> nslookup google.com\` fails
- Host machine DNS works fine
- Restarting individual containers doesn't fix it

## Root Cause
Docker's embedded DNS server (127.0.0.11) caches the host's DNS config at daemon startup. When the host network changes (DHCP renewal, VPN connect/disconnect, Wi-Fi switch), the daemon's DNS config goes stale. Containers inherit the stale config.

## Fix
\`\`\`bash
# Restart the Docker daemon to pick up new DNS config
sudo systemctl restart docker
# Or on macOS: restart Docker Desktop

# If you can't restart the daemon, restart the affected compose stack
docker compose down && docker compose up -d
\`\`\`

## Prevention
- Add explicit DNS servers in \`docker-compose.yml\`:
  \`\`\`yaml
  services:
    myapp:
      dns:
        - 1.1.1.1
        - 8.8.8.8
  \`\`\`
- This bypasses the daemon's cached DNS and survives network changes.`,
    docType: 'runbook',
    tags: 'docker,dns,networking',
  },
  {
    id: 'community_seed_002',
    title: 'Nginx Reverse Proxy 502/504 Behind Cloudflare Tunnel',
    content: `## Pattern
Intermittent 502 Bad Gateway or 504 Gateway Timeout errors when accessing services through a Cloudflare Tunnel → Nginx reverse proxy chain.

## Symptoms
- Service works fine when accessed directly (localhost:<port>)
- Errors are intermittent — sometimes it works, sometimes 502/504
- Cloudflare dashboard shows the tunnel is healthy
- Nginx error log shows \`upstream timed out\` or \`connection refused\`

## Root Cause
Three common causes:

1. **SSL mismatch**: Cloudflare terminates SSL but Nginx expects it. The proxy host has "Force SSL" enabled, causing a redirect loop or protocol mismatch.
2. **Wrong upstream address**: Nginx forwards to \`localhost\` but Docker containers can't reach the host's localhost. Use \`host.docker.internal\` (macOS/Windows) or the host's LAN IP.
3. **Timeout too short**: Cloudflare Tunnel has a 30s timeout by default. If the upstream is slow (e.g., first request after idle), it times out.

## Fix
\`\`\`nginx
# 1. Disable Force SSL in the proxy manager (CF handles SSL)
# 2. Forward to the correct address
proxy_pass http://host.docker.internal:<port>;
# 3. Increase timeouts
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
# 4. Pass the correct proto header
proxy_set_header X-Forwarded-Proto "https";
\`\`\`

## Prevention
When setting up new services behind CF Tunnel + reverse proxy:
- Always disable Force SSL on the proxy host
- Use \`host.docker.internal\` for upstream addresses
- Add the \`X-Forwarded-Proto\` header so apps construct correct URLs`,
    docType: 'runbook',
    tags: 'nginx,cloudflare,proxy,502,504',
  },
  {
    id: 'community_seed_003',
    title: 'SQLite WAL Checkpoint Stalls Under Write Contention',
    content: `## Pattern
SQLite database using WAL (Write-Ahead Logging) mode grows continuously. The WAL file becomes much larger than the main database. Performance degrades over time.

## Symptoms
- \`-wal\` file grows to hundreds of MB or more
- Read queries slow down progressively
- \`PRAGMA wal_checkpoint(TRUNCATE)\` hangs or returns busy
- Multiple processes or connections writing simultaneously

## Root Cause
WAL checkpointing requires a brief exclusive lock. If there are always active readers or writers, the checkpoint can never acquire the lock. The WAL file grows unbounded because committed pages can't be moved back to the main database.

Common triggers:
- Long-running read transactions (e.g., a backup process holding a read lock)
- High write frequency from multiple connections
- Application holding connections open longer than necessary

## Fix
\`\`\`sql
-- Force a checkpoint (will wait for active readers to finish)
PRAGMA wal_checkpoint(TRUNCATE);

-- If that hangs, identify and close long-running connections first
-- Then retry the checkpoint
\`\`\`

\`\`\`bash
# Nuclear option: stop all processes, checkpoint, restart
# This guarantees no active connections
docker compose stop <service>
sqlite3 /path/to/db.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
docker compose start <service>
\`\`\`

## Prevention
- Set \`PRAGMA busy_timeout = 5000;\` so writers retry instead of failing immediately
- Close read transactions promptly — don't hold connections open for the lifetime of a request
- If using an ORM, ensure connection pooling is configured with reasonable idle timeouts
- Consider \`PRAGMA journal_size_limit = 67108864;\` (64MB) to cap WAL growth`,
    docType: 'guide',
    tags: 'sqlite,database,wal,performance',
  },
  {
    id: 'community_seed_004',
    title: 'Container Health Check False Positives',
    content: `## Pattern
Docker health checks report a container as "unhealthy" even though the service inside is working correctly. Compose restarts the container unnecessarily, causing downtime.

## Symptoms
- \`docker ps\` shows container status as \`unhealthy\`
- Manually curling the health endpoint from inside the container succeeds
- Container gets restarted by \`restart: unless-stopped\` policy
- Service experiences periodic ~30s outages matching the restart cycle

## Root Cause
Health check timing is too aggressive for the service's startup time. The check starts running before the service is ready, accumulates failures, and marks the container unhealthy.

Common misconfigurations:
- \`start_period\` too short (or missing — defaults to 0s)
- \`interval\` too short relative to the service's response time
- \`retries\` too low (default is 3)
- Health check depends on an external service that's also starting up

## Fix
\`\`\`yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:<port>/health || exit 1"]
  interval: 30s       # Don't check too frequently
  timeout: 10s        # Give the check enough time
  retries: 5          # Tolerate transient failures
  start_period: 60s   # Grace period for startup
\`\`\`

## Key Rules
- \`start_period\` should be >= your service's worst-case startup time
- \`retries * interval\` = how long a real failure takes to detect. Balance speed vs false positives.
- Health checks should test the service itself, not its dependencies. A DB being down doesn't make the web server unhealthy — it makes it degraded.
- Use \`curl -f\` (fail on HTTP errors) not just \`curl\` (which succeeds on 500s)`,
    docType: 'guide',
    tags: 'docker,healthcheck,monitoring',
  },
  {
    id: 'community_seed_005',
    title: 'OOM Kill Recovery for Node.js Containers',
    content: `## Pattern
A Node.js container gets killed by the kernel OOM (Out of Memory) killer and either fails to restart or restarts into the same OOM condition.

## Symptoms
- Container exits with code 137 (SIGKILL)
- \`dmesg\` or \`journalctl\` shows \`oom-kill\` entries
- Container restarts but immediately gets killed again
- Host system may become sluggish before the kill

## Root Cause
Node.js defaults to a V8 heap limit of ~1.5GB (varies by version). If the container's memory limit is lower than what V8 tries to allocate, the kernel kills the process before V8's garbage collector can reclaim memory.

Common triggers:
- Processing large JSON payloads or file uploads in memory
- Unbounded caching (in-memory maps/arrays that grow indefinitely)
- Memory leaks from event listeners not being cleaned up
- Running \`npm install\` inside the container at runtime

## Fix
\`\`\`yaml
# Set container memory limit with headroom
deploy:
  resources:
    limits:
      memory: 512M

# Match Node.js heap to container limit (leave ~25% for overhead)
environment:
  - NODE_OPTIONS=--max-old-space-size=384
\`\`\`

## Immediate Recovery
\`\`\`bash
# If stuck in a restart loop, temporarily remove the memory limit
# Fix the root cause, then re-apply the limit
docker update --memory 0 <container-name>
docker restart <container-name>
\`\`\`

## Prevention
- Always set \`--max-old-space-size\` to ~75% of the container memory limit
- Stream large files instead of buffering in memory
- Use \`WeakRef\` or bounded LRU caches instead of plain objects for caching
- Monitor container memory usage over time to catch slow leaks early`,
    docType: 'runbook',
    tags: 'nodejs,docker,oom,memory',
  },
  {
    id: 'community_seed_006',
    title: 'Compose Stack Restart Ordering and Dependency Chains',
    content: `## Pattern
After a full \`docker compose down && docker compose up -d\`, services fail because they started before their dependencies were ready.

## Symptoms
- App containers exit with "connection refused" errors to databases
- Health checks fail during startup
- Running \`docker compose restart <service>\` individually fixes it
- Problem only happens on cold start, not during normal operation

## Root Cause
\`depends_on\` in Compose only waits for the container to *start*, not for the service inside to be *ready*. A PostgreSQL container can take 5-10 seconds to initialize, but the app container starts immediately after the Postgres container's entrypoint runs.

## Fix
Use \`depends_on\` with health check conditions:

\`\`\`yaml
services:
  db:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -d mydb -U myuser"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:alpine
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping | grep PONG"]
      interval: 10s
      timeout: 3s
      retries: 5

  app:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
\`\`\`

## Key Insight
The app container won't start until both \`db\` and \`redis\` pass their health checks. This replaces fragile sleep-based workarounds and retry loops in application code.`,
    docType: 'guide',
    tags: 'docker,compose,dependencies,startup',
  },
  {
    id: 'community_seed_007',
    title: 'Let\'s Encrypt Certificate Renewal Failures Through Proxy Chains',
    content: `## Pattern
SSL certificate auto-renewal fails silently. The certificate expires, causing browser security warnings and API connection failures.

## Symptoms
- Browser shows "Your connection is not private" / NET::ERR_CERT_DATE_INVALID
- \`openssl s_client -connect <domain>:443\` shows expired cert
- Renewal logs show HTTP-01 challenge failures
- The ACME challenge path \`/.well-known/acme-challenge/\` returns 404 or gets redirected

## Root Cause
The HTTP-01 challenge requires Let's Encrypt servers to reach \`http://<domain>/.well-known/acme-challenge/<token>\` on port 80. In a proxy chain (Cloudflare → reverse proxy → cert manager), the challenge request either:

1. Gets redirected to HTTPS before reaching the challenge responder
2. Gets blocked by an authentication layer (forward auth, WAF rules)
3. Gets routed to the wrong backend by the reverse proxy

## Fix
Ensure the ACME challenge path bypasses all redirects and auth:

\`\`\`nginx
# In the reverse proxy config for the domain
location /.well-known/acme-challenge/ {
    # Bypass any auth requirements
    auth_request off;
    # Don't redirect to HTTPS
    # Proxy to the cert manager
    proxy_pass http://localhost:<certmanager-port>;
}
\`\`\`

For Cloudflare: use DNS-01 challenge instead of HTTP-01. This avoids the proxy chain entirely by validating domain ownership via a DNS TXT record.

## Prevention
- Prefer DNS-01 challenges when behind Cloudflare or similar CDNs
- Set up monitoring for certificate expiry (check 14 days before)
- Test renewal with \`--dry-run\` after any proxy configuration change`,
    docType: 'runbook',
    tags: 'ssl,letsencrypt,certificates,proxy',
  },
  {
    id: 'community_seed_008',
    title: 'Memory Leak Patterns in Long-Running Node.js Containers',
    content: `## Pattern
A Node.js container's memory usage grows steadily over hours or days until it hits the memory limit and gets OOM-killed.

## Symptoms
- Memory usage in \`docker stats\` increases ~1-5MB/hour
- No single large allocation — it's a slow creep
- Restarting the container resets memory to baseline
- The leak rate correlates with request volume

## Common Causes

### 1. Event Listener Accumulation
\`\`\`javascript
// BAD: adds a new listener on every request
app.get('/data', (req, res) => {
  eventEmitter.on('update', handler); // Never removed
});

// GOOD: add once, or clean up
const handler = () => { /* ... */ };
eventEmitter.on('update', handler);
// Later: eventEmitter.off('update', handler);
\`\`\`

### 2. Unbounded Caches
\`\`\`javascript
// BAD: grows forever
const cache = {};
function getData(key) {
  if (!cache[key]) cache[key] = fetchFromDb(key);
  return cache[key];
}

// GOOD: bounded LRU cache
import { LRUCache } from 'lru-cache';
const cache = new LRUCache({ max: 1000 });
\`\`\`

### 3. Uncleared Timers/Intervals
\`\`\`javascript
// BAD: interval never cleared if connection drops
ws.on('connection', (socket) => {
  setInterval(() => socket.ping(), 30000);
});

// GOOD: clear on disconnect
ws.on('connection', (socket) => {
  const interval = setInterval(() => socket.ping(), 30000);
  socket.on('close', () => clearInterval(interval));
});
\`\`\`

## Diagnosis
\`\`\`bash
# Take a heap snapshot from inside the container
docker exec <container> node -e "
  const v8 = require('v8');
  const fs = require('fs');
  const snap = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to:', snap);
"
# Copy out and analyze in Chrome DevTools (Memory tab → Load)
docker cp <container>:/path/to/snapshot.heapsnapshot ./snapshot.heapsnapshot
\`\`\``,
    docType: 'guide',
    tags: 'nodejs,memory,leak,debugging',
  },
  {
    id: 'community_seed_009',
    title: 'Backup Cascade: One Failure Triggering Downstream Timeouts',
    content: `## Pattern
A backup job for one service fails or runs long, causing timeouts and failures in other services that share resources (disk I/O, network, CPU).

## Symptoms
- Service A's backup starts at 2:00 AM, runs long due to data growth
- Service B's backup starts at 2:30 AM, competes for disk I/O
- Both backups slow to a crawl, exceeding their timeout windows
- Cron jobs stack up — next run starts before previous finishes
- In worst case, disk fills up from multiple partial backups

## Root Cause
Backup jobs are scheduled close together and compete for shared resources:
- **Disk I/O**: Multiple large reads/writes saturate the disk
- **CPU**: Compression (gzip/zstd) pegs CPU cores
- **Network**: Offsite uploads compete for bandwidth
- **Disk space**: Multiple uncompressed dumps can exceed available space

## Fix
\`\`\`bash
# 1. Stagger backup schedules (at least 1 hour apart)
# Service A: 1:00 AM
# Service B: 3:00 AM
# Service C: 5:00 AM

# 2. Use lock files to prevent overlap
LOCKFILE="/tmp/backup.lock"
if [ -f "$LOCKFILE" ]; then
  echo "Another backup is running, skipping"
  exit 0
fi
trap "rm -f $LOCKFILE" EXIT
touch "$LOCKFILE"

# 3. Limit I/O priority
ionice -c3 nice -n 19 pg_dump mydb | gzip > backup.sql.gz
\`\`\`

## Prevention
- Space backups at least 1 hour apart
- Use \`ionice\` and \`nice\` to lower backup process priority
- Set timeouts on backup commands so they fail fast instead of blocking
- Monitor disk space before starting a backup, abort if below threshold
- Compress inline (\`pg_dump | gzip\`) instead of dump-then-compress to save disk space`,
    docType: 'runbook',
    tags: 'backup,scheduling,performance,disk',
  },
  {
    id: 'community_seed_010',
    title: 'macOS TCC Permission Denials Blocking Docker Volume Mounts',
    content: `## Pattern
Docker containers can't access mounted volumes on macOS. Files appear empty, permissions are denied, or the mount point exists but contains no data.

## Symptoms
- Container logs show \`Permission denied\` on mounted paths
- \`ls\` inside the container shows the mount point but it's empty
- Same compose file works on Linux but not macOS
- Docker Desktop shows no errors

## Root Cause
macOS TCC (Transparency, Consent, and Control) restricts which applications can access certain directories. Docker Desktop needs explicit permission to access directories outside \`~/\`, and some directories within \`~/\` (like Desktop, Documents, Downloads) require additional consent.

If Docker Desktop wasn't granted Full Disk Access, or if the specific directory wasn't approved in Privacy settings, volume mounts silently fail — the mount point exists but Docker can't read the host files.

## Fix
1. **System Settings → Privacy & Security → Full Disk Access**
2. Enable the toggle for **Docker Desktop** (or **Docker** if using CLI install)
3. If Docker isn't in the list, click \`+\` and add it from \`/Applications/Docker.app\`
4. Restart Docker Desktop after granting access

For specific directory access:
1. **System Settings → Privacy & Security → Files and Folders**
2. Check that Docker has access to the directories you're mounting

## Prevention
- Grant Full Disk Access to Docker Desktop on initial setup
- Prefer mounting from paths Docker already has access to (\`~/\` is usually safe)
- When using external volumes (e.g., \`/Volumes/\`), verify TCC access first
- Test mounts with a simple \`docker run -v /path:/test alpine ls /test\` before building complex stacks`,
    docType: 'guide',
    tags: 'macos,docker,permissions,tcc',
  },
  {
    id: 'community_seed_011',
    title: 'n8n Workflow Cron Triggers Not Firing After Container Restart',
    content: `## Pattern
n8n cron/schedule triggers stop firing after a container restart or workflow update via API. Workflows show as active but never execute.

## Symptoms
- Workflow is marked "Active" in the n8n UI
- Cron trigger has a valid schedule
- No executions appear in the execution log
- Manual "Execute Workflow" works fine
- Other trigger types (webhook) still work

## Root Cause
n8n registers cron triggers in memory at startup. When workflows are modified via the API (not the UI), the cron scheduler isn't notified of the change. The workflow's schedule exists in the database but isn't registered with the in-memory cron system.

## Fix
\`\`\`bash
# Restart the n8n container to re-register all cron triggers
docker restart <n8n-container>

# Verify triggers are registered by checking logs
docker logs <n8n-container> --tail 50 | grep -i "cron\|schedule\|trigger"
\`\`\`

## Prevention
- Always restart the n8n container after updating workflows via API
- If using a management script, add the restart as a post-update step
- For critical scheduled workflows, set up external monitoring that alerts if no execution has occurred within 2x the expected interval`,
    docType: 'runbook',
    tags: 'n8n,cron,automation,scheduling',
  },
  {
    id: 'community_seed_012',
    title: 'PostgreSQL Connection Exhaustion in Containerized Apps',
    content: `## Pattern
Application suddenly starts failing with "too many connections" or "connection refused" errors to PostgreSQL, even though the database is running and healthy.

## Symptoms
- App logs: \`FATAL: too many connections for role\` or \`sorry, too many clients already\`
- \`SELECT count(*) FROM pg_stat_activity;\` shows connections at or near \`max_connections\`
- Many connections in \`idle\` state
- Problem correlates with app restarts or deployments

## Root Cause
Each app restart creates new database connections but the old ones aren't cleaned up immediately. PostgreSQL's default \`max_connections\` is 100. With connection pooling misconfigured (or absent), each app instance opens its own pool:

- App starts → opens 10 connections
- App crashes → connections linger in \`idle\` state until TCP timeout (often 2+ hours)
- App restarts → opens 10 more connections
- After a few restart cycles, \`max_connections\` is exhausted

## Fix
\`\`\`sql
-- Immediate: terminate idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND state_change < NOW() - INTERVAL '10 minutes'
  AND pid <> pg_backend_pid();
\`\`\`

\`\`\`yaml
# Long-term: configure connection limits
# In postgresql.conf or as env vars
POSTGRES_MAX_CONNECTIONS: 200
# In your app's connection pool
DB_POOL_MIN: 2
DB_POOL_MAX: 10
DB_POOL_IDLE_TIMEOUT: 30000  # 30 seconds
\`\`\`

## Prevention
- Use a connection pooler (PgBouncer) between apps and PostgreSQL
- Set \`idle_in_transaction_session_timeout\` in PostgreSQL to kill stale connections
- Configure your ORM/driver's pool with a reasonable \`max\` and \`idleTimeoutMillis\`
- Monitor \`pg_stat_activity\` connection count as a health metric`,
    docType: 'runbook',
    tags: 'postgresql,database,connections,pooling',
  },
  {
    id: 'community_seed_013',
    title: 'Container Log Disk Space Exhaustion',
    content: `## Pattern
Docker host runs out of disk space due to container logs growing unchecked. Services start failing with "no space left on device" errors.

## Symptoms
- \`df -h\` shows \`/var/lib/docker\` (or Docker's data root) at 100%
- \`docker system df\` shows large "Local Volumes" or "Build Cache"
- Individual container logs are gigabytes in size
- \`du -sh /var/lib/docker/containers/*/\` reveals the culprits

## Root Cause
Docker's default JSON log driver has no size limit. A verbose container can generate gigabytes of logs. The logs persist even after the container is restarted.

## Fix
\`\`\`bash
# Immediate: truncate a specific container's log
truncate -s 0 $(docker inspect --format='{{.LogPath}}' <container-name>)

# Clean up everything (stopped containers, unused images, build cache)
docker system prune -a --volumes
\`\`\`

\`\`\`json
// Long-term: configure Docker daemon log limits
// /etc/docker/daemon.json (or Docker Desktop settings)
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
\`\`\`

\`\`\`yaml
# Per-container override in docker-compose.yml
services:
  verbose-app:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
\`\`\`

## Prevention
- Always set log rotation in the Docker daemon config
- Monitor disk space on the Docker host
- For very verbose services, consider \`driver: none\` if logs aren't needed
- Run \`docker system prune\` on a weekly cron`,
    docType: 'guide',
    tags: 'docker,logs,disk,storage',
  },
  {
    id: 'community_seed_014',
    title: 'Rate Limiting Bypass via X-Forwarded-For Header Spoofing',
    content: `## Pattern
Rate limiting based on client IP is ineffective because the application reads a spoofable header instead of the actual client IP.

## Symptoms
- Rate limits don't seem to work — users can make unlimited requests
- Different users appear to share the same IP in logs
- Or: legitimate users get rate limited because they share a proxy IP

## Root Cause
The application uses \`X-Forwarded-For\` or \`X-Real-IP\` headers to determine the client IP, but doesn't validate who set those headers. An attacker can send:

\`\`\`
X-Forwarded-For: 1.2.3.4
\`\`\`

And appear as a different IP on every request, bypassing per-IP rate limits entirely.

## Fix
Only trust proxy headers from known, trusted sources:

\`\`\`javascript
// In Express/Node.js
app.set('trust proxy', ['loopback', '10.0.0.0/8', '172.16.0.0/12']);
// Only trust X-Forwarded-For from these CIDR ranges

// Better: use the LAST entry in X-Forwarded-For from a trusted proxy
// Cloudflare: use CF-Connecting-IP header (can't be spoofed by the client)
const clientIp = req.headers['cf-connecting-ip'] || req.ip;
\`\`\`

## Prevention
- If behind Cloudflare, use \`CF-Connecting-IP\` — it's set by Cloudflare and can't be spoofed by the client
- If behind a known reverse proxy, configure \`trust proxy\` to only trust that proxy's IP range
- Never use the raw \`X-Forwarded-For\` header without filtering — it's a client-controlled value
- Test your rate limiting by sending requests with spoofed headers`,
    docType: 'guide',
    tags: 'security,rate-limiting,proxy,headers',
  },
  {
    id: 'community_seed_015',
    title: 'Restic Backup Failures: Repository Lock Contention',
    content: `## Pattern
Restic backup jobs fail with "repository is already locked" errors, preventing backups from completing.

## Symptoms
- \`restic backup\` exits with: \`Fatal: unable to create lock: repository is already locked\`
- The lock was left by a previous backup that crashed or was killed
- Automated backup scripts fail silently night after night
- No recent successful backup exists

## Root Cause
Restic uses lock files to prevent concurrent repository access. If a backup process is killed (OOM, timeout, SIGKILL), it can't clean up its lock file. Subsequent backup attempts see the stale lock and refuse to proceed.

## Fix
\`\`\`bash
# Remove stale locks (safe if no other backup is actually running)
restic unlock

# Then retry the backup
restic backup /path/to/data

# If unlock doesn't work, check for actually running processes first
ps aux | grep restic
# Only force-unlock if nothing is running
\`\`\`

## Prevention
\`\`\`bash
# Add unlock + timeout to your backup script
#!/bin/bash
restic unlock --cleanup-cache 2>/dev/null
timeout 3600 restic backup /path/to/data

# If the backup takes longer than 1 hour, it gets killed cleanly
# The next run's unlock will clear the lock
\`\`\`

- Always run \`restic unlock\` at the start of automated backup scripts
- Set a timeout on backup jobs so they don't run indefinitely
- Monitor for consecutive backup failures (alert after 2+ failures)
- Use \`restic check\` periodically to verify repository integrity`,
    docType: 'runbook',
    tags: 'restic,backup,locks,automation',
  },

  // ── Windlass — Schedule-Aware Service Management ─────────────────────
  {
    id: 'community_guide_windlass',
    title: 'Windlass — Schedule-Aware Service Management',
    content: `## What Is Windlass?

Windlass is StdOut's built-in tool for schedule-aware container management. It tracks which services are running, which should be running, and when — then lets you control them from a single dashboard.

The core idea: **your service schedule IS your alert policy.** If a service is scheduled to run from 11 PM to 4 AM, Windlass only alerts you during that window. Outside it, silence is expected, so silence is enforced. No more false alarms for services you intentionally stopped.

## Key Concepts

### Service Classifications

Every service in Windlass has a classification that determines its behavior:

| Classification | Behavior | Alerts |
|---------------|----------|--------|
| **Always On** | Expected to run 24/7 | Alert anytime service goes down |
| **Scheduled** | Runs during a defined time window (cron-based) | Alert only during runtime window |
| **On-Demand** | Started manually or by external trigger, stops when idle | Alert only while actively running |
| **Manual** | Never auto-managed, no monitoring | No automatic alerts |

### Schedule as Alert Policy

This is what makes Windlass different from simple container monitoring:

- A **scheduled** service with a runtime window of 23:00–04:00 will only trigger alerts between 11 PM and 4 AM
- Outside that window, the service being stopped is **expected** — no alert fires
- State changes are still logged, so you have full history
- If a service crashes during its runtime window, the alert fires immediately

## Getting Started

### Step 1: Install the Windlass Engine

Windlass has two parts: an **engine** that runs on your Docker host, and the **StdOut UI** that displays and controls it.

The engine is a lightweight Python script that runs on a schedule (via cron, systemd timer, or launchd):

\`\`\`bash
# Download the engine
curl -o ~/.local/bin/windlass https://raw.githubusercontent.com/seayniclabs/windlass/main/windlass.py
chmod +x ~/.local/bin/windlass

# Create the config directory
mkdir -p /opt/windlass
\`\`\`

### Step 2: Create Your Schedule

Create \`/opt/windlass/schedule.yaml\` to define your services:

\`\`\`yaml
services:
  nginx-proxy-manager:
    compose_path: /opt/containers/npm
    containers: [npm]
    type: always
    memory_mb: 150
    priority: 1
    description: Reverse proxy for all services

  postiz:
    compose_path: /opt/containers/postiz
    containers: [postiz-app, postiz-worker, postiz-postgres, postiz-redis]
    type: schedule
    memory_mb: 2300
    priority: 4
    description: Social media scheduler
    cron_start: "0 23 * * *"    # Start at 11 PM
    cron_stop: "0 4 * * *"      # Stop at 4 AM

  grafana:
    compose_path: /opt/containers/grafana
    containers: [grafana]
    type: on-demand
    memory_mb: 250
    priority: 3
    description: Dashboards and metrics
    idle_shutdown_minutes: 30
\`\`\`

**Service types:**
- \`always\` — runs 24/7, restarted if stopped
- \`schedule\` — started/stopped on a cron schedule
- \`on-demand\` — started externally, auto-stopped after idle timeout
- \`manual\` — tracked but never auto-managed

### Step 3: Start the Windlass Server

The engine includes a lightweight HTTP server that StdOut reads from:

\`\`\`bash
# Run the engine once (evaluates schedule, starts/stops services)
windlass --run

# Start the status server (serves status.json for StdOut)
windlass --serve --port 8116
\`\`\`

For production, set up a recurring schedule:

\`\`\`bash
# crontab example: evaluate every 5 minutes
*/5 * * * * /usr/local/bin/windlass --run >> /var/log/windlass.log 2>&1
\`\`\`

### Step 4: Connect to StdOut

1. Navigate to **Windlass** in StdOut's nav bar
2. Enter your Windlass endpoint URL (e.g., \`http://localhost:8116\` or \`http://your-host:8116\`)
3. Click **Connect**
4. Click **Sync** to pull in your service registry

## The Dashboard

Once connected and synced, the Windlass dashboard shows:

- **Summary gauges** — running, stopped, scheduled, and total memory usage
- **Service cards** — grouped by classification (Always On, Scheduled, On-Demand, Manual)
- **State indicators** — green (running), gray (stopped), orange (partial), red (error)
- **Mismatch warnings** — a red \`!\` badge when a service's actual state doesn't match its expected state
- **Recent events** — a log of state changes, syncs, and manual actions

## Timeline View

Click **Timeline** to see a 24-hour Gantt chart of all services:

- Green blocks = Always On services
- Blue blocks = Scheduled runtime windows
- Orange blocks = On-Demand services currently running
- A vertical line marks the current time

This gives you an at-a-glance view of your infrastructure's daily rhythm.

## Service Controls

Click any service card to see its detail page, where you can:

- **Start / Stop / Restart** — manual controls that take effect on the next Windlass cycle
- **View properties** — memory, container count, priority, compose path
- **View schedule** — runtime window, cron expressions (for scheduled services)
- **View event history** — every state change, sync, and manual action for this service

## How Sync Works

StdOut reads from the Windlass engine's \`status.json\` endpoint. This file is updated every time the engine runs and contains:

- Current state of all services (running/stopped/partial)
- Memory usage per service
- Upcoming scheduled events
- Recent event history
- Schedule windows for the next 24 hours

StdOut doesn't directly start or stop containers. It sends commands to Windlass, which manages Docker Compose stacks on your behalf.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Windlass not configured" | No endpoint URL saved | Go to Windlass page, enter URL, click Connect |
| Sync fails with connection error | Engine not running or wrong URL | Verify \`windlass --serve\` is running and the port is correct |
| Services show "unknown" state | Haven't synced yet | Click Sync on the dashboard |
| Mismatch warning on scheduled service | Service stopped outside its window | Expected behavior — no action needed |
| Manual control doesn't take effect | Windlass processes commands on its next cycle | Wait up to 5 minutes, or run \`windlass --run\` manually |`,
    docType: 'guide',
    tags: 'windlass,scheduling,containers,docker,alerts',
  },
];
