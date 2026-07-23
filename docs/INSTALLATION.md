# StdOut Installation Guide

## Prerequisites

- Docker Engine 20.10+ (or Docker Desktop)
- 2GB RAM minimum, 4GB recommended
- 10GB disk space
- Linux, macOS, or Windows with WSL2

## Quick Start (Docker Compose)

### 1. Clone Repository

```bash
git clone https://github.com/seayniclabs/stdout.git
cd stdout
```

### 2. Generate Secrets

```bash
# Generate session encryption key
export SECRET_KEY=$(openssl rand -hex 32)

# Create environment file
cat > .env << EOF
# Required
SECRET_KEY=${SECRET_KEY}
DB_PATH=/data/stdout.db
APP_URL=http://localhost:8112

# Optional - BYO-AI (provide your own AI)
# Ollama (default, runs locally)
OLLAMA_URL=http://172.17.0.1:11434
OBSERVATORY_ANALYST_MODEL=qwen2.5:14b-instruct-q4_K_M
OBSERVATORY_WATCHER_MODEL=llama3.2:3b-instruct-q4_K_M

# OR Claude API
ANTHROPIC_API_KEY=sk-ant-...

# OR Gemini API  
GEMINI_API_KEY=...

# Optional services
RESEND_API_KEY=...  # Email notifications
WINDLASS_URL=http://windlass:8116  # Scheduler (included in compose)
EOF
```

### 3. Start Stack

```bash
docker-compose up -d
```

### 4. Access StdOut

Open http://localhost:8112 in your browser.

**First-time setup:**
1. Create your admin account (first user is automatically admin)
2. Configure AI provider in Settings → AI Providers
3. Create your first monitor or import from scanner

## Installation Methods

### Method 1: Docker Compose (Recommended)

Full stack with Windlass scheduler, mDNS discovery, and Observatory AI.

```bash
docker-compose up -d
```

**Services included:**
- StdOut (port 8112)
- Windlass scheduler (port 8116)
- Avahi mDNS (`stdout.local` discovery)
- Observatory Sentinel AI backend

**Data persistence:**
```bash
./data/stdout.db          # Main database
./data/backups/           # Database backups
./windlass-config/        # Windlass schedules
```

### Method 2: Standalone Docker

Minimal single-container deployment.

```bash
docker run -d \
  --name stdout \
  --restart unless-stopped \
  -p 8112:3000 \
  -v $(pwd)/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e SECRET_KEY=$(openssl rand -hex 32) \
  -e DB_PATH=/data/stdout.db \
  -e APP_URL=http://localhost:8112 \
  -e OLLAMA_URL=http://172.17.0.1:11434 \
  charlieseay/stdout:latest
```

**Access:** http://localhost:8112

### Method 3: From Source (Development)

```bash
git clone https://github.com/seayniclabs/stdout.git
cd stdout
npm install

# Create database
mkdir -p data
export DB_PATH=./data/stdout.db
node scripts/migrate.js

# Start dev server
npm run dev
```

**Access:** http://localhost:4321

## Configuration

### Environment Variables

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `SECRET_KEY` | Session encryption key (32+ chars) | `openssl rand -hex 32` |
| `DB_PATH` | SQLite database path | `/data/stdout.db` |
| `APP_URL` | Public-facing URL | `https://stdout.yourdomain.com` |

#### AI Providers (BYO-AI - choose one or more)

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_URL` | Ollama API endpoint | `http://172.17.0.1:11434` |
| `OLLAMA_MODEL` | Ollama model name | `qwen2.5:14b-instruct` |
| `ANTHROPIC_API_KEY` | Claude API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GEMINI_API_KEY` | Google Gemini API key | - |

#### Optional Services

| Variable | Description | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Email notification API key | - |
| `WINDLASS_URL` | Windlass scheduler URL | `http://windlass:8116` |
| `SENTINEL_API_URL` | Observatory Sentinel URL | `http://observatory-sentinel:8081` |
| `GRAFANA_URL` | Grafana instance URL | - |
| `GRAFANA_API_KEY` | Grafana API key | - |

### Reverse Proxy Setup

#### nginx

```nginx
upstream stdout {
    server localhost:8112;
}

server {
    listen 443 ssl http2;
    server_name stdout.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://stdout;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (if needed)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### Caddy

```caddyfile
stdout.yourdomain.com {
    reverse_proxy localhost:8112
}
```

#### Traefik (Docker labels)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.stdout.rule=Host(`stdout.yourdomain.com`)"
  - "traefik.http.routers.stdout.entrypoints=websecure"
  - "traefik.http.routers.stdout.tls=true"
  - "traefik.http.services.stdout.loadbalancer.server.port=3000"
```

## BYO-AI Setup

StdOut uses a **Bring Your Own AI** architecture - you provide the AI, we provide the agent and interface.

### Option 1: Ollama (Local, Free)

**Install Ollama:**
```bash
curl https://ollama.ai/install.sh | sh
```

**Pull models:**
```bash
ollama pull qwen2.5:14b-instruct-q4_K_M  # Observatory Analyst
ollama pull llama3.2:3b-instruct-q4_K_M   # Observatory Watcher
```

**Configure StdOut:**
```bash
OLLAMA_URL=http://172.17.0.1:11434
OBSERVATORY_ANALYST_MODEL=qwen2.5:14b-instruct-q4_K_M
OBSERVATORY_WATCHER_MODEL=llama3.2:3b-instruct-q4_K_M
```

### Option 2: Claude API (Cloud, Paid)

**Get API key:** https://console.anthropic.com/

**Configure StdOut:**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Usage in app:** Settings → AI Providers → Add Claude

### Option 3: Gemini API (Cloud, Free Tier)

**Get API key:** https://aistudio.google.com/

**Configure StdOut:**
```bash
GEMINI_API_KEY=...
```

### Option 4: Multiple Providers

You can configure multiple AI providers and choose per-task:

```bash
OLLAMA_URL=http://172.17.0.1:11434
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
```

## First-Time Setup

### 1. Create Admin Account

Navigate to http://localhost:8112 and register the first user.

**Note:** The first user is automatically assigned the `admin` role with all permissions.

### 2. Configure AI Providers

Settings → AI Providers → Add your preferred provider(s).

### 3. Create Your First Monitor

**Option A: Manual Creation**
1. Dashboard → Monitors → Create Monitor
2. Type: HTTP, TCP, Docker, or Custom
3. Configure check interval and notifications

**Option B: Scanner Import**
1. Run: `docker exec stdout npx stdout-scanner scan`
2. Dashboard → Stacks → Import from Scanner
3. Review and confirm auto-detected services

### 4. Set Up Notifications (Optional)

Settings → Notifications → Configure channels:
- Email (via Resend)
- Slack
- Discord
- Webhook

## Data Backup

### Manual Backup

```bash
# Backup database
docker exec stdout sqlite3 /data/stdout.db ".backup '/data/backups/stdout-$(date +%Y%m%d).db'"

# Or from host
cp ./data/stdout.db ./data/backups/stdout-$(date +%Y%m%d).db
```

### Automated Backups

Add to crontab:

```bash
# Daily backup at 2 AM
0 2 * * * docker exec stdout sqlite3 /data/stdout.db ".backup '/data/backups/stdout-$(date +\%Y\%m\%d).db'"

# Keep last 30 days
0 3 * * * find ./data/backups -name "stdout-*.db" -mtime +30 -delete
```

## Upgrade

### Docker Compose

```bash
docker-compose pull
docker-compose up -d
```

Database migrations run automatically on startup.

### Standalone Docker

```bash
docker pull charlieseay/stdout:latest
docker stop stdout
docker rm stdout

# Start with same configuration as before
docker run -d \
  --name stdout \
  --restart unless-stopped \
  -p 8112:3000 \
  -v $(pwd)/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file .env \
  charlieseay/stdout:latest
```

### From Source

```bash
git pull
npm install
npm run build
```

Restart the server.

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs stdout
```

Common issues:
- Missing `SECRET_KEY` environment variable
- Database permission issues
- Port 8112 already in use

### Database locked errors

```bash
# Stop all instances
docker stop stdout

# Check for lock file
ls -la ./data/*.db-*

# Remove stale locks
rm ./data/*.db-shm ./data/*.db-wal

# Restart
docker start stdout
```

### Health check failing

```bash
# Check internal health
docker exec stdout wget -qO- http://127.0.0.1:3000/healthz

# Check from host
curl http://localhost:8112/health
```

### Observatory AI not working

Check AI provider configuration:
1. Settings → AI Providers
2. Verify API keys are valid
3. Test connection

For Ollama:
```bash
curl http://172.17.0.1:11434/api/tags
```

### Windlass scheduler not running

```bash
docker logs windlass

# Restart scheduler
docker restart windlass
```

## Uninstall

### Docker Compose

```bash
docker-compose down -v  # -v removes volumes (deletes data!)
```

**Keep data:**
```bash
docker-compose down
# Backup data/ directory before deleting
```

### Standalone Docker

```bash
docker stop stdout
docker rm stdout

# Delete data (optional)
rm -rf ./data
```

## Support

- **Documentation:** https://github.com/seayniclabs/stdout/tree/main/docs
- **Issues:** https://github.com/seayniclabs/stdout/issues
- **Discussions:** https://github.com/seayniclabs/stdout/discussions
- **Email:** support@seayniclabs.com

## Next Steps

- [Configuration Guide](CONFIGURATION.md)
- [API Documentation](API.md)
- [Security Best Practices](SECURITY.md)
- [Troubleshooting Guide](TROUBLESHOOTING.md)
