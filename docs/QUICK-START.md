# StdOut Quick Start Guide

**Version:** 1.0.0  
**Last Updated:** 2026-08-11

Get StdOut running in 5 minutes.

## Installation

```bash
# Pull latest image
docker pull charlieseay/stdout:latest

# Run container
docker run -d \
  --name stdout \
  -p 3000:3000 \
  -v ~/stdout-data:/app/data \
  --restart unless-stopped \
  charlieseay/stdout:latest
```

Access at: **http://localhost:3000**

## First-Time Setup

### Step 1: Create Admin Account

1. Open http://localhost:3000
2. Enter your name, email, and password
3. Click **Create Account & Continue**

### Step 2: Brand Your Environment

1. **Workspace Name:** e.g., "Home Lab", "Production"
2. **Logo (Optional):** Drag & drop or browse (PNG/SVG/JPEG, max 2MB)
3. **Accent Color:** Choose your theme color
4. Click **Continue →**

### Step 3: License

- **Have a license?** Enter key and email, click **Activate**
- **Evaluating?** Click **Skip for Now**

That's it! You're in StdOut.

## Core Features

### Dashboard

- **Health Overview:** Infrastructure status at a glance
- **Active Incidents:** Unresolved issues by severity
- **Recent Activity:** Latest events and changes

### Incidents

**Create Incident:**
1. Click **Incidents** → **New Incident**
2. Describe the issue
3. Set severity (Critical/High/Medium/Low)
4. Assign to yourself or teammate
5. Click **Create**

**Resolve Incident:**
1. Open incident
2. Document resolution steps
3. Click **Resolve**

### Knowledge Base

**Add Documentation:**
1. Click **Docs** → **New Doc**
2. Choose type: Runbook, Post-Mortem, Guide, Note
3. Write content (Markdown supported)
4. Add tags for searchability
5. Click **Save**

**Search Docs:**
- Use search bar at top
- Riggins AI can query your docs for you

### Infrastructure

**Add Stack:**
1. Click **Infrastructure** → **Add Stack**
2. Name your environment (e.g., "Production Web")
3. Add services/servers to the stack
4. Save

**Add Monitor:**
1. Select a stack
2. Click **Add Monitor**
3. Choose type: HTTP, Ping, Docker, Custom
4. Configure check interval and thresholds
5. Save

### Riggins AI Assistant

**How to Use:**
1. Click **Observatory** in sidebar (or robot icon)
2. Ask questions about your infrastructure:
   - "What's using the most CPU?"
   - "Show me recent errors"
   - "Explain this spike in memory"
3. Riggins queries your knowledge base and metrics

**What Riggins Can Do:**
- Understand infrastructure metrics
- Explain anomalies and baselines
- Answer questions about your stacks
- Search knowledge base documentation
- Interpret dashboards and logs

## Common Tasks

### Configure Branding After Setup

1. Click **Settings** (gear icon in nav)
2. Update workspace name, logo, or color
3. Click **Save Changes**

### Add Users

1. Settings → **Users** → **Invite User**
2. Enter email address
3. Choose role: Admin, Operator, or Viewer
4. Send invitation

### Enable Notifications

1. Settings → **Notifications**
2. Add channel: Email, Slack, Discord, Webhook
3. Configure channel settings
4. Save

### Backup Database

```bash
# From host
docker exec stdout sqlite3 /app/data/stdout.db ".backup /app/data/backup.db"
cp ~/stdout-data/backup.db ~/stdout-backup-$(date +%Y%m%d).db
```

### Upgrade StdOut

```bash
# Backup first!
docker exec stdout sqlite3 /app/data/stdout.db ".backup /app/data/backup.db"

# Pull latest
docker pull charlieseay/stdout:latest

# Recreate container
docker stop stdout && docker rm stdout
docker run -d \
  --name stdout \
  -p 3000:3000 \
  -v ~/stdout-data:/app/data \
  --restart unless-stopped \
  charlieseay/stdout:latest
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs stdout

# Common fix: Port conflict
docker run -p 8080:3000 ...  # Use different host port
```

### Can't Access Web Interface

```bash
# Verify container running
docker ps | grep stdout

# Check health
curl http://localhost:3000/healthz
```

### Database Errors

```bash
# Check database integrity
docker exec stdout sqlite3 /app/data/stdout.db "PRAGMA integrity_check"

# If corrupted, restore from backup
docker stop stdout
cp ~/stdout-backup-20260811.db ~/stdout-data/stdout.db
docker start stdout
```

### Performance Issues

```bash
# Check resource usage
docker stats stdout

# Increase container limits
docker update --memory=4g --cpus=2 stdout
```

## Next Steps

- **Read the [User Guide](USER-GUIDE.md)** for detailed feature documentation
- **Read the [Admin Guide](ADMIN-GUIDE.md)** for advanced configuration
- **Join the community:** https://community.stdout.io
- **Get support:** support@seayniclabs.com

## Keyboard Shortcuts

- **`/`** - Focus search
- **`?`** - Show shortcuts
- **`g d`** - Go to Dashboard
- **`g i`** - Go to Incidents
- **`g k`** - Go to Knowledge Base
- **`n i`** - New Incident
- **`n d`** - New Doc

## Tips

1. **Tag everything** - Makes search much better
2. **Write runbooks as you resolve issues** - Auto-learning captures them
3. **Use stacks to organize** - Group related services together
4. **Set realistic check intervals** - 60s is good for most services
5. **Enable notifications** - Don't miss critical alerts

## Getting Help

- **Documentation:** Full guides in `/docs/` folder
- **GitHub Issues:** https://github.com/seayniclabs/stdout/issues
- **Community Forum:** https://community.stdout.io
- **Email:** support@seayniclabs.com

---

**Need more details?** See the full [Installation Guide](INSTALLATION.md), [User Guide](USER-GUIDE.md), or [Admin Guide](ADMIN-GUIDE.md).
