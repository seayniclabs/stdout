---
title: "n8n Workflow Backup and Restore"
type: runbook
tags: n8n, backup, automation, workflows, disaster-recovery
---

## Purpose

Protect your n8n workflow automations from data loss. n8n stores workflows, credentials, and execution history in a database (SQLite by default, PostgreSQL if configured). Losing this data means rebuilding every workflow from scratch — and if you have dozens of automations, that's days of work.

## What to Back Up

| Data | Location | Priority |
|------|----------|----------|
| Workflows | Database | Critical — this is your automation logic |
| Credentials | Database (encrypted) | Critical — API keys, OAuth tokens, webhook secrets |
| Execution history | Database | Low — useful for debugging but not essential |
| Environment variables | `.env` file or Compose | High — encryption key, database connection |
| Custom nodes | `~/.n8n/custom/` or mounted volume | Medium — if you use community nodes |

**The most important thing to back up is the `N8N_ENCRYPTION_KEY`.** Credentials are encrypted with this key. If you restore a database backup but use a different encryption key, all credential references will fail silently — workflows will run but auth will break everywhere.

## Method 1: API Export (Workflow JSON)

n8n's REST API can export all workflows as JSON. This is the most portable format — you can import these into any n8n instance.

```bash
#!/bin/bash
BACKUP_DIR="/path/to/backups/n8n"
TIMESTAMP=$(date +%Y%m%d-%H%M)
N8N_URL="http://localhost:5678"
N8N_API_KEY="<your-n8n-api-key>"

mkdir -p "$BACKUP_DIR/$TIMESTAMP"

# Export all workflows
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_URL/api/v1/workflows?limit=250" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
for wf in data.get('data', []):
    name = wf['name'].replace('/', '-').replace(' ', '_')
    with open(f'$BACKUP_DIR/$TIMESTAMP/{name}__{wf[\"id\"]}.json', 'w') as f:
        json.dump(wf, f, indent=2)
    print(f'Exported: {wf[\"name\"]} ({wf[\"id\"]})')
"

echo "Backup complete: $BACKUP_DIR/$TIMESTAMP"
ls -la "$BACKUP_DIR/$TIMESTAMP" | wc -l
```

**Limitation:** API export does not include credentials. The workflow JSON references credential IDs, but the actual secrets are in the database. You need the database backup for full restore.

## Method 2: Database Backup (Complete)

### SQLite (Default)

```bash
# Find the database
docker exec n8n ls -la /home/node/.n8n/database.sqlite

# Backup using SQLite's .backup command (safe while n8n is running)
docker exec n8n sqlite3 /home/node/.n8n/database.sqlite \
  ".backup '/home/node/.n8n/database-backup.sqlite'"

# Copy to host
docker cp n8n:/home/node/.n8n/database-backup.sqlite \
  /path/to/backups/n8n/database-$(date +%Y%m%d).sqlite

# Clean up
docker exec n8n rm /home/node/.n8n/database-backup.sqlite
```

### PostgreSQL

```bash
docker exec n8n-postgres pg_dump -U n8n n8n > /path/to/backups/n8n/n8n-$(date +%Y%m%d).sql
```

### Back Up the Encryption Key

```bash
# From your docker-compose.yml or .env — find and save the encryption key
grep N8N_ENCRYPTION_KEY /path/to/n8n/.env >> /path/to/backups/n8n/encryption-key.txt
chmod 600 /path/to/backups/n8n/encryption-key.txt
```

Store this separately and securely. Without it, database backups are useless for credential recovery.

## Restore Procedures

### Restore from API Export (Workflows Only)

```bash
# Import a single workflow
curl -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow-file.json \
  "$N8N_URL/api/v1/workflows"
```

After import, you'll need to re-create all credentials manually and re-link them in each workflow. This is tedious but works for migrating to a completely new instance.

### Restore from Database (Full)

```bash
# Stop n8n
docker stop n8n

# Replace the database
docker cp /path/to/backups/n8n/database-20260329.sqlite \
  n8n:/home/node/.n8n/database.sqlite

# CRITICAL: Ensure the encryption key matches
# The N8N_ENCRYPTION_KEY in your .env must be the same one
# used when the backup was created

# Start n8n
docker start n8n
```

Verify by opening the n8n UI and checking that workflows load and credentials connect.

## Automation

Schedule daily backups combining both methods:

```bash
#!/bin/bash
# Daily n8n backup — runs at 2am via cron/launchd
set -e

BACKUP_DIR="/path/to/backups/n8n/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# 1. Database backup (complete — includes credentials)
docker exec n8n sqlite3 /home/node/.n8n/database.sqlite \
  ".backup '/home/node/.n8n/backup.sqlite'"
docker cp n8n:/home/node/.n8n/backup.sqlite "$BACKUP_DIR/database.sqlite"
docker exec n8n rm /home/node/.n8n/backup.sqlite

# 2. API export (portable — human-readable workflow JSON)
# [API export script from above]

# 3. Integrity check
sqlite3 "$BACKUP_DIR/database.sqlite" "PRAGMA integrity_check;" | grep -q "ok" && \
  echo "Integrity: OK" || echo "WARNING: Database integrity check failed"

# 4. Prune backups older than 30 days
find /path/to/backups/n8n -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

## Important: Never Restart n8n During Backup

Before running any backup that interacts with the n8n container, check for running executions:

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_URL/api/v1/executions?status=running&limit=10" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d.get(\"data\",[]))} running')"
```

If workflows are actively executing, wait for them to finish. Restarting n8n (or even heavy database operations) during execution can kill long-running workflows — I've lost TTS audio generation jobs this way.

## What Good Looks Like

A healthy n8n backup strategy produces:

- Daily database snapshots with integrity verification
- Weekly API exports (portable JSON) stored separately from database backups
- Encryption key stored in a secure location outside the backup directory
- 30-day retention on daily backups, 90 days on weekly exports
- Tested restore procedure (actually restore to a test instance quarterly)
