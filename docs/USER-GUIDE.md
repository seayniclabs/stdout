# StdOut User Guide

Complete guide to using StdOut for infrastructure monitoring and incident management.

## Table of Contents

- [Getting Started](#getting-started)
- [Setup Wizard](#setup-wizard)
- [Dashboard Overview](#dashboard-overview)
- [Monitors](#monitors)
- [Incidents](#incidents)
- [Riggins AI Assistant](#riggins-ai-assistant)
- [Knowledge Base](#knowledge-base)
- [Settings](#settings)

## Getting Started

### First Login

After installation, navigate to `http://localhost:8112` (or your configured domain).

**First-time setup wizard guides you through:**
1. Create admin account
2. Set workspace branding (name, logo, colors)
3. Enter license key (optional during evaluation)

### Navigation

**Main menu (left sidebar):**
- **Dashboard** - Overview of your infrastructure health
- **Incidents** - Active and historical incidents
- **HUD** - Real-time heads-up display
- **Observatory** - AI monitoring configuration
- **Discovery** - Network and service discovery
- **Alerts** - Alert rules and notifications
- **Infrastructure** - Stacks, monitors, satellites
- **Docs** - Knowledge base and runbooks
- **Tools** - Windlass task scheduler
- **Add-ons** - Extensions and integrations

## Setup Wizard

### Step 1: Admin Account

Create your administrator account:
- **Email** - Used for login and notifications
- **Password** - Min 8 characters (strong password recommended)
- **Display Name** - How you appear in the UI

### Step 2: Workspace Branding

**Customize StdOut for your environment:**

**Workspace Name**
- Default: "StdOut"
- Examples: "Home Lab", "Production", "Acme IT"
- Appears in nav bar and page titles

**Logo Upload**
- Drag & drop or browse to upload
- Formats: PNG, SVG, JPEG
- Max size: 2MB
- Appears in navigation bar

**Accent Color**
- 6 presets: Emerald, Indigo, Blue, Orange, Violet, Rose
- Or custom hex color
- Affects buttons, links, and UI accents

### Step 3: License

**Enter your license key:**
- Format: `SL-XXXX-XXXX-XXXX-XXXX`
- Get from: store.seayniclabs.com
- Optional during evaluation (30 days)

**License tiers:**
- **Solo** ($0) - 10 monitors, 1 user
- **Pro** ($29/mo) - 100 monitors, 5 users, advanced features
- **Enterprise** ($149/mo) - Unlimited, SSO, HA, priority support

## Dashboard Overview

### At-a-Glance Metrics

**Health Score**
- Overall infrastructure health (0-100%)
- Based on: active incidents, monitor status, baseline deviations

**Active Incidents**
- Count of unresolved incidents
- Breakdown by severity (Critical, High, Medium, Low)

**Monitors**
- Total configured monitors
- Online vs offline status

**Recent Activity**
- Last 10 events (incidents, resolutions, discoveries)

### Quick Actions

- **Create Incident** - Manually log an issue
- **Add Monitor** - Configure new monitoring target
- **Run Discovery** - Scan network for new services

## Monitors

### Creating a Monitor

**Navigate to Infrastructure → Add Monitor**

**Monitor Types:**
1. **HTTP/HTTPS** - Web endpoints, APIs
2. **Ping** - Network connectivity
3. **TCP Port** - Service availability
4. **Docker Container** - Container health
5. **System Metrics** - CPU, memory, disk, network

**Example: HTTP Monitor**
```
Name: Production API
Type: HTTP
URL: https://api.example.com/health
Interval: 60 seconds
Timeout: 5 seconds
Expected Status: 200
Alert on: 3 consecutive failures
```

### Monitor Configuration

**Basic Settings:**
- **Name** - Descriptive name
- **Stack** - Logical grouping (e.g., "Production", "Database Cluster")
- **Interval** - How often to check (30s, 60s, 5m, etc.)
- **Timeout** - Max wait time before failure

**Alert Rules:**
- **Threshold** - Consecutive failures before alerting
- **Severity** - Critical, High, Medium, Low
- **Notifications** - Email, webhook, Slack

**Advanced:**
- **Baseline Learning** - Auto-learn normal behavior
- **Anomaly Detection** - AI-powered anomaly alerts
- **Maintenance Windows** - Pause monitoring during deployments

### Monitor Status

**States:**
- 🟢 **Healthy** - All checks passing
- 🟡 **Warning** - Degraded but functional
- 🔴 **Critical** - Service down or failing
- ⚪ **Unknown** - No recent data
- 🔵 **Maintenance** - Intentionally paused

## Incidents

### Incident Lifecycle

1. **Detected** - Auto-created by monitor or manually logged
2. **Investigating** - Team is diagnosing root cause
3. **Monitoring** - Issue mitigated, watching for recurrence
4. **Resolved** - Fixed and verified
5. **Closed** - Post-mortem complete

### Creating an Incident

**Manual incident creation:**

Navigate to **Incidents → New Incident**

**Required fields:**
- **Title** - Short description (e.g., "API Gateway 502 errors")
- **Description** - Detailed symptoms and impact
- **Severity** - Critical, High, Medium, Low

**Optional fields:**
- **Affected Services** - Which services are impacted
- **Stack** - Which infrastructure stack
- **Assigned To** - Team member handling it

### Working an Incident

**Investigation phase:**
1. **Set status** to "Investigating"
2. **Add diagnosis** - Document what you're finding
3. **Request help** - Ask Riggins for assistance (see below)
4. **Attach logs** - Upload relevant log files

**Resolution phase:**
1. **Document fix** - What actions resolved it
2. **Set status** to "Resolved"
3. **Add post-mortem** - Lessons learned (auto-generated)

### Incident Details

**Information displayed:**
- Timeline of status changes
- Diagnosis notes
- Resolution steps
- Riggins AI analysis (if requested)
- Related incidents (similar past issues)
- Affected monitors

## Riggins AI Assistant

**Riggins is your autonomous AI incident responder.**

### How Riggins Works

1. **Watches** monitors continuously
2. **Detects** anomalies and incidents
3. **Diagnoses** root causes automatically
4. **Suggests** remediation steps
5. **Learns** from every resolution (Open-Notebook RAG)

### Autonomous Mode

**Observatory → Configure:**
- **Operating Mode** - Discover, Watch, or Autopilot
- **Autopilot Level** - How autonomous (1-3)
- **RAG Sources** - Include internal docs, community KB, public web

**Modes explained:**
- **Discover** (Level 0) - Only scans network, no incident handling
- **Watch** (Level 1) - Detects + diagnoses, waits for approval
- **Autopilot** (Level 2-3) - Autonomous remediation (restarts, scaling, etc.)

### Asking Riggins for Help

**On any incident page:**
1. Click "Ask Riggins"
2. Riggins analyzes logs, metrics, and knowledge base
3. Returns: Diagnosis + recommended actions
4. You approve or modify the plan
5. Riggins executes (or you do manually)

**What Riggins can do:**
- Restart containers
- Scale services
- Run diagnostics
- Search knowledge base for similar incidents
- Generate post-mortems
- Propose preventive measures

### Trust & Safety

**Riggins never:**
- Deletes data
- Modifies production code
- Changes network/firewall rules
- Spends money (API calls, cloud resources)

**Riggins always:**
- Asks permission for destructive actions
- Logs all actions taken
- Provides rationale for recommendations
- Learns from your feedback

## Knowledge Base

**Navigate to Docs**

### Document Types

**Guides** - Step-by-step instructions (e.g., "Troubleshooting OOMKilled containers")
**Runbooks** - Operational procedures
**Post-Mortems** - Auto-generated from resolved incidents
**Notes** - Free-form documentation

### Creating a Document

1. Navigate to **Docs → New Document**
2. Choose type (Guide, Runbook, Note)
3. Write in Markdown
4. Add tags for searchability
5. Set visibility (Private or Public)

**Example runbook:**
```markdown
# Restarting Production API

## When to Use
- API is unresponsive (HTTP 503)
- Health check failing

## Steps
1. Check logs: `docker logs prod-api`
2. Verify issue: `curl https://api.example.com/health`
3. Restart: `docker restart prod-api`
4. Verify: Check health endpoint again
5. Monitor: Watch for 5 minutes

## Rollback
If restart doesn't help, check database connection.
```

### Searching the Knowledge Base

**Search bar (top right):**
- Keywords: "docker restart", "memory leak", "502 error"
- Filters: Type, tags, date range
- Results ranked by relevance (Open-Notebook RAG)

**Riggins uses this automatically** - When diagnosing incidents, Riggins searches the knowledge base for similar past issues and proven solutions.

### Community Knowledge

**Public knowledge packs (licensed users only):**
- Kubernetes Incident Playbooks (50+ guides)
- Docker Troubleshooting (25+ guides)
- Database Performance (30+ guides)
- Linux Server Hardening (15+ guides)

**Free getting-started docs:**
- StdOut setup guides
- Monitor configuration
- Basic troubleshooting

## Settings

### Account Settings

**Profile:**
- Update display name
- Change password
- Set notification preferences

**License:**
- View current tier
- Enter new license key
- Check usage (monitors, users, storage)

### Workspace Branding

**Change after setup:**
1. Navigate to **Settings → Account**
2. Scroll to "Workspace Branding"
3. Update name, logo, or color
4. Click "Save branding"
5. Refresh page to see changes

**Reset to defaults:**
- Click "Reset to Defaults"
- Restores StdOut branding

### Notifications

**Configure alert delivery:**
- **Email** - Send to: your@email.com
- **Webhook** - POST to: https://hooks.example.com
- **Slack** - Coming soon

**Events:**
- `incident_created` - New incident detected
- `diagnosis_complete` - Riggins finished analysis
- `severity_critical` - Any critical-severity event
- `backup_complete` - Database backup finished

### Appearance

**Skins (themes):**
- Navigate to **Settings → Appearance → Manage Skins**
- Choose from: Default, Dark Mode, High Contrast, Custom
- Create custom skins (CSS override)

## Tips & Best Practices

### Monitor Setup

✅ **DO:**
- Group related services into stacks
- Start with critical services only
- Use reasonable intervals (60s for most)
- Enable baseline learning for stable services

❌ **DON'T:**
- Monitor every single endpoint (creates noise)
- Set intervals < 30s (causes load)
- Alert on first failure (use 3+ consecutive)
- Forget to set maintenance windows

### Incident Management

✅ **DO:**
- Document diagnosis as you investigate
- Tag incidents with relevant keywords
- Link to related monitors
- Write clear resolution notes (helps Riggins learn)

❌ **DON'T:**
- Close incidents immediately (let Riggins generate post-mortem)
- Skip post-mortem review
- Ignore recurring patterns
- Forget to update monitor thresholds after resolution

### Knowledge Base

✅ **DO:**
- Write runbooks for common operations
- Use clear, action-oriented titles
- Tag liberally (aids search)
- Update docs when procedures change

❌ **DON'T:**
- Paste logs directly (summarize instead)
- Write novel-length guides (keep focused)
- Duplicate content (search first)
- Forget to tag as "getting-started" for public docs

## Keyboard Shortcuts

- `G + D` - Go to Dashboard
- `G + I` - Go to Incidents
- `G + M` - Go to Monitors
- `G + K` - Go to Knowledge Base
- `/ ` - Focus search
- `N` - New incident (on incidents page)
- `?` - Show all shortcuts

## Support

### Getting Help

1. **Search knowledge base** - Docs tab
2. **Community Discord** - discord.gg/seayniclabs
3. **Email support** - support@seayniclabs.com
4. **GitHub issues** - github.com/seayniclabs/stdout/issues

### Reporting Bugs

Include:
- StdOut version (Settings → About)
- Browser/OS
- Steps to reproduce
- Screenshots or logs
- Expected vs actual behavior

### Feature Requests

- Submit via Feedback tab (Settings)
- Vote on existing requests
- Track status (Submitted → Reviewing → Planned → Shipped)

## Next Steps

- **Set up monitors** for your critical services
- **Configure notifications** so you're alerted
- **Try Riggins** on a test incident
- **Write your first runbook**
- **Explore community knowledge packs**

**Advanced guides:**
- [Admin Guide](./ADMIN-GUIDE.md) - Backups, performance tuning
- [Developer Guide](./DEVELOPER-GUIDE.md) - API, contributing, architecture
