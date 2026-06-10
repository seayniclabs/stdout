# StdOut Installation Guide

## Quick Start

Run this one command on your target device (Mac Mini, ThinkPad, Raspberry Pi, server):

```bash
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

Or clone and run locally:

```bash
git clone https://github.com/seayniclabs/stdout
cd stdout
chmod +x install.sh
./install.sh
```

## What Happens Next

The installer will:

1. ✅ **Check prerequisites** — Docker, Docker Compose, network connectivity
2. ✅ **Pull setup server** — Downloads the ephemeral setup container
3. ✅ **Start setup wizard** — Launches visual installer at `http://stdout.local:8888`
4. 🌐 **Open in browser** — Follow the URL shown in your terminal
5. ⚙️ **Complete setup** — Fill out admin email, password, environment name
6. 📦 **Install StdOut** — Watch real-time progress as containers deploy
7. ✨ **Done!** — StdOut running at `http://stdout.local:8112`

## Terminal Output Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Setup Server Running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Open in your browser:
  → http://stdout.local:8888
  → http://192.168.0.100:8888
  → http://localhost:8888 (if running locally)

Installation will begin when you open the URL above.
Waiting for setup to complete...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Installation Log:

[2026-06-10 21:15:23] Waiting for browser connection...
[2026-06-10 21:15:45] Browser connected from 192.168.0.100
[2026-06-10 21:15:48] Step 1/8: Configuration generated ✓
[2026-06-10 21:16:02] Step 2/8: Images pulled ✓
[2026-06-10 21:16:15] Step 3/8: Containers started ✓
[2026-06-10 21:16:45] Step 4/8: Health checks passed ✓
[2026-06-10 21:16:52] Step 5/8: Database initialized ✓
[2026-06-10 21:16:55] Step 6/8: Admin account created ✓
[2026-06-10 21:16:57] Step 7/8: Environment configured ✓
[2026-06-10 21:17:00] Step 8/8: Installation complete ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Installation Complete!
  
  StdOut is now running at:
    → http://stdout.local:8112
    → http://192.168.0.100:8112
  
  Shutting down setup server...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Magic URL: `stdout.local`

The installer uses mDNS (Bonjour) to broadcast `stdout.local` on your local network. This works automatically on:

- ✅ macOS (built-in Bonjour)
- ✅ Linux with Avahi daemon
- ✅ Windows with Bonjour Print Services
- ✅ iOS/Android on the same network

**If `stdout.local` doesn't resolve:**
- Use the IP address shown in the terminal instead
- Check your router allows mDNS/multicast (port 5353 UDP)
- Install Avahi on Linux: `sudo apt-get install avahi-daemon`

## Prerequisites

- **Docker** — version 20.10 or later
- **Docker Compose** — version 2.0 or later
- **Network access** — to pull images from GitHub Container Registry
- **Ports available:**
  - `8888` — Setup server (temporary, removed after installation)
  - `8112` — StdOut web interface
  - `8116` — Windlass scanner service

## Installation Steps (Visual Wizard)

When you open `http://stdout.local:8888`, you'll see:

### Step 1: Create Admin Account
- **Email:** Your admin email address
- **Password:** Minimum 8 characters
- **Environment Name:** What to call this installation (e.g., "Production", "Homelab")

### Step 2: Installation Progress
Real-time progress with 8 steps:

1. **Generate Configuration** — Creates docker-compose.yml
2. **Pull Docker Images** — Downloads stdout and windlass
3. **Start Containers** — Launches both services
4. **Wait for Health Checks** — Ensures containers are healthy
5. **Initialize Database** — Creates SQLite schema
6. **Create Admin Account** — Sets up your admin user
7. **Configure Environment** — Saves environment name
8. **Finalize Installation** — Marks installation complete

Each step shows:
- ✓ **Completed** — green checkmark
- ⏳ **In Progress** — spinning icon
- ⏸ **Pending** — waiting to start

### Step 3: Completion
- Shows final URL: `http://stdout.local:8112`
- Auto-redirects in 5 seconds
- Setup server self-destructs

## What Gets Installed

After installation completes, you'll have:

- **StdOut container** — Main application (port 8112)
- **Windlass container** — Scanner service (port 8116)
- **SQLite database** — Stored in Docker volume `stdout-data`
- **Admin user** — Credentials you provided during setup

## Post-Installation

1. **Login** at http://stdout.local:8112
2. **Configure scanner** — Settings → Scanner → Set schedule
3. **Add monitors** — HUD → Create Monitor
4. **Invite team** — Settings → Team (Shop tier and above)

## Troubleshooting

### "Port 8888 already in use"

Find what's using it:
```bash
lsof -i :8888
```

Kill the process or wait for setup server to auto-remove.

### "Docker daemon not running"

**macOS/Windows:** Start Docker Desktop  
**Linux:** `sudo systemctl start docker`

### "Setup server failed to start"

Check logs:
```bash
docker logs stdout-setup
```

Clean up and retry:
```bash
docker stop stdout-setup && docker rm stdout-setup
./install.sh
```

### "Images failed to pull"

Check network connectivity:
```bash
curl -I https://ghcr.io
```

If offline or behind firewall, manually load images:
```bash
# Download tarball from GitHub releases
docker load < stdout-v1.0.0.tar.gz
docker load < windlass-v1.0.0.tar.gz
docker load < stdout-setup-v1.0.0.tar.gz
./install.sh
```

### "Installation stuck at step X"

The setup server streams logs to your terminal. If it hangs:

1. Check Docker resources (CPU/memory)
2. Check Docker logs: `docker logs stdout`
3. Cancel and retry (setup is idempotent)

## Manual Installation (Advanced)

If you prefer manual control:

```bash
# 1. Clone repo
git clone https://github.com/seayniclabs/stdout
cd stdout

# 2. Create docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'
services:
  stdout:
    image: ghcr.io/charlieseay/stdout:latest
    container_name: stdout
    hostname: stdout
    ports:
      - "8112:3000"
    environment:
      - TZ=America/Chicago
      - NODE_ENV=production
      - DATABASE_PATH=/data/central.db
    volumes:
      - stdout-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

  windlass:
    image: ghcr.io/charlieseay/windlass:latest
    container_name: windlass
    ports:
      - "8116:8116"
    environment:
      - TZ=America/Chicago
      - STDOUT_API_URL=http://stdout:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8116/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

volumes:
  stdout-data:
EOF

# 3. Start containers
docker compose up -d

# 4. Wait for healthy
until docker exec stdout curl -f http://localhost:3000/healthz; do sleep 2; done

# 5. Create admin user
docker exec stdout node scripts/create-admin.js admin@example.com your-password

# 6. Set environment name
docker exec stdout node scripts/set-env-name.js Production

# 7. Mark installation complete
docker exec stdout node scripts/mark-installation-complete.js

# 8. Verify
curl http://localhost:8112/healthz
```

## Uninstall

To completely remove StdOut:

```bash
# Stop and remove containers
docker compose down

# Remove volumes (deletes all data)
docker volume rm stdout-data

# Remove images
docker rmi ghcr.io/charlieseay/stdout:latest
docker rmi ghcr.io/charlieseay/windlass:latest
docker rmi ghcr.io/charlieseay/stdout-setup:latest
```

## Upgrade

To upgrade to a newer version:

```bash
# Pull latest images
docker compose pull

# Restart containers
docker compose up -d

# Check version
curl http://localhost:8112/healthz
```

Database migrations run automatically on container startup.

## Support

- **Documentation:** https://docs.stdout.io
- **GitHub Issues:** https://github.com/seayniclabs/stdout/issues
- **Community:** https://discord.gg/stdout

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser: http://stdout.local:8112     │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  StdOut Container (port 8112)           │
│  - Astro SSR + Node adapter             │
│  - SQLite database                      │
│  - Auth + RBAC + API                    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Windlass Container (port 8116)         │
│  - Docker scanner                       │
│  - Network discovery                    │
│  - Scheduled tasks                      │
└─────────────────────────────────────────┘
```

## License

MIT — see [LICENSE](LICENSE) for details.
