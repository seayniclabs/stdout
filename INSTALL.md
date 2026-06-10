# StdOut Installation Guide

StdOut uses a **Home Assistant-style visual installer** with real-time progress tracking. The installer is ephemeral — it runs once, completes setup, then self-destructs, leaving only StdOut and Windlass running.

---

## Installation Paths

StdOut requires a valid license key for installation. Purchase at [https://stdout.io/pricing](https://stdout.io/pricing).

### 1. Online Install (Recommended)

**Best for:** Systems with internet access

```bash
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

This automatically:
- Checks prerequisites (Docker, ports, network)
- Pulls the setup server image
- Starts the visual installer at `http://stdout.local:8888`
- Prompts for your license key during setup
- Validates license and installs StdOut

**You will need:** Your license key from your purchase email (format: `SL-XXXX-XXXX-...`)

### 2. Offline Install

**Best for:** Air-gapped systems, slow connections, large deployments

```bash
# Download bundle and license from your account dashboard
# Then run:
./install.sh --offline --bundle stdout-bundle.tar.gz --license stdout.license
```

**You will need:**
- `stdout-bundle.tar.gz` — Download from [https://stdout.io/download](https://stdout.io/download)
- `stdout.license` — Download from your purchase email or account dashboard

This method:
- Loads Docker images from local bundle (no internet required)
- Uses pre-signed offline license file
- Completes installation entirely offline

### 3. Manual Install (Advanced)

**Best for:** Custom environments, CI/CD pipelines, automation

See [Manual Installation](#manual-installation-advanced) section below.

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

## System Requirements

### Minimum Requirements by Platform

| Platform | CPU | RAM | Storage | Architecture | Notes |
|----------|-----|-----|---------|--------------|-------|
| **x86_64 Linux** | 2 cores | 2 GB | 5 GB free | AMD64 | Recommended for production |
| **ARM64 Linux** | 2 cores | 2 GB | 5 GB free | ARM64/AArch64 | Works on most ARM servers |
| **Raspberry Pi 4/5** | 4 cores | 4 GB | 8 GB free | ARM64 | Pi 3 not supported, Pi 4 with 2GB may struggle |
| **macOS (Intel)** | 2 cores | 4 GB | 5 GB free | AMD64 | Via Docker Desktop |
| **macOS (Apple Silicon)** | 2 cores | 4 GB | 5 GB free | ARM64 | Via Docker Desktop |
| **Windows 10/11** | 2 cores | 4 GB | 5 GB free | AMD64 | Via Docker Desktop with WSL2 |

**Performance Notes:**
- Raspberry Pi 4 with 2GB RAM will work but may experience slowness with large container counts (>20)
- Raspberry Pi 3 is **not supported** (insufficient memory for Node.js + SQLite under load)
- ARM platforms require multi-arch images — ensure your Docker version supports `linux/arm64`
- SSDs strongly recommended over SD cards (especially on Raspberry Pi)

### Software Prerequisites

- **Docker Engine** — version 20.10+ ([install guide](https://docs.docker.com/engine/install/))
  - The installer checks for `docker` command availability
  - Must have access to `/var/run/docker.sock`
  - ARM platforms: ensure Docker supports `linux/arm64` platform
- **Docker Compose** — version 2.0+ (plugin or standalone)
  - Plugin: `docker compose` (recommended, built into modern Docker)
  - Standalone: `docker-compose` command (legacy, still supported)
- **Network access** — to pull images from `ghcr.io/seayniclabs/*`
  - If offline: pre-load images via `docker load` (see [Air-Gapped Install](#air-gapped-installation))
- **Available ports:**
  - `8888` — Setup server (temporary, removed after installation)
  - `8112` — StdOut web interface
  - `8116` — Windlass scanner service

### Optional (for magic URL)

- **mDNS/Avahi** — for `stdout.local` hostname resolution
  - **macOS:** Built-in (Bonjour)
  - **Linux:** `sudo apt-get install avahi-daemon` (Ubuntu/Debian) or `sudo yum install avahi` (RHEL/CentOS)
  - **Windows:** Install Bonjour Print Services
  - **Not required** — installer shows IP address fallback if mDNS unavailable

### StdOut Application Requirements

The StdOut Docker image must include these scripts for the installer to complete:

- `npm run db:migrate` — Initialize database schema
- `scripts/create-admin.js` — Create admin user (args: email, password)
- `scripts/set-env-name.js` — Set environment name (args: name)
- `scripts/mark-installation-complete.js` — Mark installation as complete

**Developer Note:** If building from source, ensure these scripts exist before pushing the image to GHCR.

## License Requirements

StdOut is licensed software. You need a valid license key to install and run StdOut in production.

### License Key Format

License keys follow the format: `SL-<payload>.<signature>`

Example: `SL-eyJwcm9kdWN0Ijoi...`.`abc123def456...`

### Getting a License

1. **Purchase:** Visit [https://stdout.io/pricing](https://stdout.io/pricing)
2. **Receive:** License key sent to your email
3. **Activate:** Enter key during installation or in Settings after install

### License Types

- **Self-Hosted:** Perpetual license for self-hosted deployments
- **Development:** Free for non-production use (requires activation)

### Offline Licenses

For air-gapped installations, download both:
- **Bundle:** `stdout-bundle.tar.gz` (Docker images)
- **License:** `stdout.license` (cryptographically signed license file)

Both are available from your account dashboard after purchase.

### Runtime Validation

StdOut validates your license on every startup:
- **Online:** Validates via API (5s timeout)
- **Offline:** Validates using local license file signature
- **Development:** License check skipped in dev mode (`NODE_ENV=development`)

If no valid license is found, StdOut will exit with an error message.

## Installation Steps (Visual Wizard)

When you open `http://stdout.local:8888`, you'll see:

### Step 1: Enter License & Create Admin Account
- **License Key:** Your StdOut license key (format: `SL-XXXX-...`)
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

## Setting Up a Clean Box from Zero

If you're starting with a fresh server (Ubuntu, Debian, RHEL, etc.), follow this guide to prepare it for StdOut installation.

### Ubuntu/Debian (20.04+, 22.04+, 24.04+)

```bash
# Update system packages
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install Avahi (for stdout.local magic URL)
sudo apt-get install -y avahi-daemon avahi-utils
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

# Verify Docker is running
docker --version
docker compose version

# Set hostname (optional, enables mDNS as stdout.local)
sudo hostnamectl set-hostname stdout

# Now run StdOut installer
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

### RHEL/CentOS/Rocky Linux (8+, 9+)

```bash
# Update system packages
sudo yum update -y

# Install Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker

# Install Avahi (for stdout.local magic URL)
sudo yum install -y avahi avahi-tools
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

# Verify Docker is running
docker --version
docker compose version

# Set hostname (optional)
sudo hostnamectl set-hostname stdout

# Now run StdOut installer
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

### macOS (Ventura+, Sonoma+, Sequoia+)

```bash
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop/
# Or via Homebrew:
brew install --cask docker

# Start Docker Desktop (GUI or CLI)
open -a Docker

# Wait for Docker to start
until docker info > /dev/null 2>&1; do sleep 1; done

# Verify
docker --version
docker compose version

# Note: macOS has built-in Bonjour, so stdout.local works automatically

# Now run StdOut installer
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

### Raspberry Pi 4/5 (64-bit OS Required)

**Supported Models:**
- ✅ Raspberry Pi 5 (all RAM variants)
- ✅ Raspberry Pi 4 Model B with 4GB or 8GB RAM
- ⚠️ Raspberry Pi 4 Model B with 2GB RAM (may struggle with >20 containers)
- ❌ Raspberry Pi 3 or earlier (insufficient RAM)

**OS Requirement:** 64-bit Raspberry Pi OS (Bookworm or later)
- Check with: `uname -m` (should output `aarch64`, not `armv7l`)
- If running 32-bit OS, flash 64-bit Raspberry Pi OS from https://www.raspberrypi.com/software/

```bash
# Verify 64-bit OS
uname -m  # Must show: aarch64

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker (ARM64-compatible)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install Avahi
sudo apt-get install -y avahi-daemon avahi-utils
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

# Set hostname
sudo hostnamectl set-hostname stdout

# Verify
docker --version

# IMPORTANT: Use SSD for Docker storage on Raspberry Pi
# SD cards are too slow for database + Docker workloads
# If using USB SSD, move Docker data directory:
# sudo systemctl stop docker
# sudo mv /var/lib/docker /mnt/ssd/docker
# sudo ln -s /mnt/ssd/docker /var/lib/docker
# sudo systemctl start docker

# Now run StdOut installer
curl -fsSL https://raw.githubusercontent.com/seayniclabs/stdout/main/install.sh | bash
```

**Raspberry Pi Performance Tips:**
- Use USB 3.0 SSD for Docker storage — SD cards will cause severe performance degradation
- Ensure adequate cooling (heatsink + fan recommended for Pi 4, passive heatsink sufficient for Pi 5)
- Monitor with Pi 4 2GB RAM: limit Docker to ~15 monitored containers
- For >30 containers, upgrade to Pi 5 with 8GB RAM or use x86_64 hardware

### Post-Setup Verification

After setting up Docker and Avahi, verify everything works:

```bash
# Check Docker daemon
docker info

# Check Docker Compose
docker compose version

# Check Avahi (Linux only)
systemctl status avahi-daemon

# Test mDNS resolution (should show your IP)
avahi-browse -at | grep stdout

# Check ports are free
sudo lsof -i :8888  # Should be empty
sudo lsof -i :8112  # Should be empty
sudo lsof -i :8116  # Should be empty
```

If all checks pass, you're ready to install StdOut!

---

## Air-Gapped Installation

If your server has no internet access, you can pre-load the Docker images:

```bash
# On a machine with internet, pull and save images
docker pull ghcr.io/seayniclabs/stdout:latest
docker pull ghcr.io/seayniclabs/windlass:latest
docker pull ghcr.io/charlieseay/stdout-setup:latest

docker save ghcr.io/seayniclabs/stdout:latest -o stdout.tar
docker save ghcr.io/seayniclabs/windlass:latest -o windlass.tar
docker save ghcr.io/charlieseay/stdout-setup:latest -o stdout-setup.tar

# Transfer .tar files to air-gapped server

# On air-gapped server, load images
docker load -i stdout.tar
docker load -i windlass.tar
docker load -i stdout-setup.tar

# Now run the installer (it will use local images)
./install.sh
```

---

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
