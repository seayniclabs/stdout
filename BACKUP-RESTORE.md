# StdOut Backup & Restore Guide

**Last updated:** 2026-08-16  
**Applies to:** StdOut v1.0+

---

## Overview

StdOut uses SQLite for all data storage. This makes backups simple — copy one file, restore one file. No external database servers to manage.

**What gets backed up:**
- All incidents and resolutions
- Knowledge base articles (including auto-learned post-mortems)
- Infrastructure discovery data
- User accounts and sessions
- Settings and configurations
- API tokens and licenses
- Audit logs

---

## Quick Backup (Manual)

### While StdOut is Running

SQLite WAL mode allows safe backups while StdOut is running:

```bash
# Stop for 100% consistency (optional but recommended)
docker compose down

# Backup the entire data directory
tar czf stdout-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C ~/stdout-data .

# Restart
docker compose up -d
```

**Backup location:** Store backups somewhere safe:
- External drive: `/Volumes/backups/stdout/`
- NAS: `/mnt/nas/backups/stdout/`
- Cloud: S3, Google Drive, etc.

### Without Stopping StdOut

If you must backup while running (not recommended for production):

```bash
# Use SQLite .backup command
docker exec stdout sh -c 'sqlite3 /app/data/stdout.db ".backup /app/data/stdout-backup.db"'

# Copy the backup out
docker cp stdout:/app/data/stdout-backup.db ~/stdout-backup-$(date +%Y%m%d).db

# Clean up temp file
docker exec stdout rm /app/data/stdout-backup.db
```

---

## Automated Backups

### Option 1: Cron Job (Recommended)

Create `/etc/cron.d/stdout-backup`:

```bash
#!/bin/bash
# Daily backup at 2:30 AM
30 2 * * * root /usr/local/bin/stdout-backup.sh

# Weekly backup on Sunday at 3:00 AM
0 3 * * 0 root /usr/local/bin/stdout-backup.sh weekly
```

Create `/usr/local/bin/stdout-backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/path/to/backups"
RETENTION_DAYS=30  # Keep daily backups for 30 days
WEEKLY_RETENTION=12  # Keep weekly backups for ~3 months

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_TYPE=${1:-daily}

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR/$BACKUP_TYPE"

# Backup using tar
cd ~/stdout-data
tar czf "$BACKUP_DIR/$BACKUP_TYPE/stdout-$TIMESTAMP.tar.gz" .

# Remove old backups
if [ "$BACKUP_TYPE" = "daily" ]; then
  find "$BACKUP_DIR/daily" -name "stdout-*.tar.gz" -mtime +$RETENTION_DAYS -delete
elif [ "$BACKUP_TYPE" = "weekly" ]; then
  find "$BACKUP_DIR/weekly" -name "stdout-*.tar.gz" -mtime +$((WEEKLY_RETENTION * 7)) -delete
fi

echo "Backup completed: $BACKUP_DIR/$BACKUP_TYPE/stdout-$TIMESTAMP.tar.gz"
```

Make it executable:

```bash
chmod +x /usr/local/bin/stdout-backup.sh
```

### Option 2: Docker Backup Container

Use a sidecar container to handle backups:

**Add to docker-compose.yml:**

```yaml
services:
  stdout-backup:
    image: alpine:latest
    container_name: stdout-backup
    volumes:
      - ./data:/data:ro
      - /path/to/backups:/backups
    environment:
      - BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
      - RETENTION_DAYS=30
    entrypoint: |
      sh -c '
        apk add --no-cache tar gzip dcron
        echo "$BACKUP_SCHEDULE tar czf /backups/stdout-\$(date +%Y%m%d-%H%M%S).tar.gz -C /data ." | crontab -
        find /backups -name "stdout-*.tar.gz" -mtime +$RETENTION_DAYS -delete
        crond -f -l 2
      '
    restart: unless-stopped
```

---

## Restore from Backup

### Full Restore

1. **Stop StdOut:**
   ```bash
   docker compose down
   ```

2. **Remove old data:**
   ```bash
   rm -rf ~/stdout-data/*
   ```

3. **Extract backup:**
   ```bash
   tar xzf /path/to/backups/stdout-YYYYMMDD-HHMMSS.tar.gz -C ~/stdout-data
   ```

4. **Restart StdOut:**
   ```bash
   docker compose up -d
   ```

5. **Verify:**
   ```bash
   # Check logs
   docker compose logs -f stdout

   # Open browser and verify data
   open http://localhost:8112
   ```

### Selective Restore (Database Only)

If you only need to restore the database (not uploaded files):

```bash
# Stop StdOut
docker compose down

# Restore database
cp /path/to/backups/stdout.db ~/stdout-data/stdout.db

# Restart
docker compose up -d
```

---

## Migration to New Server

### Export (Old Server)

```bash
# Stop StdOut
docker compose down

# Create full backup
tar czf stdout-migration-$(date +%Y%m%d).tar.gz \
  -C ~ \
  stdout-data \
  docker-compose.yml \
  .env

# Copy to new server
scp stdout-migration-*.tar.gz user@new-server:/tmp/
```

### Import (New Server)

```bash
# Extract files
cd ~
tar xzf /tmp/stdout-migration-*.tar.gz

# Verify .env has correct APP_URL for new server
nano .env

# Start StdOut
docker compose up -d

# Verify
curl -I http://localhost:8112
```

---

## Disaster Recovery

### Scenario: Database Corruption

**Symptoms:**
- `database disk image is malformed`
- SQLite errors in logs
- StdOut won't start

**Recovery:**

1. **Try SQLite integrity check:**
   ```bash
   docker exec stdout sqlite3 /app/data/stdout.db "PRAGMA integrity_check;"
   ```

2. **If check fails, restore from backup:**
   ```bash
   docker compose down
   rm ~/stdout-data/stdout.db
   cp /path/to/backups/latest/stdout.db ~/stdout-data/
   docker compose up -d
   ```

3. **If no backup, try recovery:**
   ```bash
   # Dump what SQLite can read
   docker exec stdout sh -c 'sqlite3 /app/data/stdout.db .dump > /tmp/dump.sql'
   
   # Create new database from dump
   docker exec stdout sh -c 'cat /tmp/dump.sql | sqlite3 /app/data/stdout-recovered.db'
   
   # Replace old database
   docker compose down
   mv ~/stdout-data/stdout.db ~/stdout-data/stdout-corrupted.db
   mv ~/stdout-data/stdout-recovered.db ~/stdout-data/stdout.db
   docker compose up -d
   ```

### Scenario: Accidental Data Deletion

**If you deleted incidents/knowledge base articles:**

1. **Stop StdOut immediately:**
   ```bash
   docker compose down
   ```

2. **Restore from most recent backup:**
   ```bash
   tar xzf /path/to/backups/latest/stdout-*.tar.gz -C ~/stdout-data
   docker compose up -d
   ```

3. **Verify data is restored:**
   - Open StdOut dashboard
   - Check incident count
   - Verify knowledge base articles

### Scenario: Lost License Key

**StdOut won't start without valid license:**

1. **Find your license key:**
   - Check purchase confirmation email
   - Check backup of `.env` file
   - Contact support: hello@seayniclabs.com

2. **Re-enter license:**
   - If StdOut is running: Settings → License → Update
   - If StdOut won't start: Edit `.env` → `LICENSE_KEY=SL-...`

---

## Backup Verification

**Test your backups regularly!**

### Monthly Backup Test

1. **Create test instance:**
   ```bash
   mkdir ~/stdout-test
   cd ~/stdout-test
   
   # Extract backup
   tar xzf /path/to/backups/latest/stdout-*.tar.gz
   
   # Copy compose files
   cp ~/docker-compose.yml .
   cp ~/.env .env
   
   # Change port to avoid conflict
   sed -i 's/8112:3000/9112:3000/' docker-compose.yml
   sed -i 's/:8112/:9112/' .env
   ```

2. **Start test instance:**
   ```bash
   docker compose up -d
   ```

3. **Verify:**
   ```bash
   # Check logs
   docker compose logs -f
   
   # Open in browser
   open http://localhost:9112
   
   # Verify:
   # - Can log in
   # - Incident count matches production
   # - Knowledge base articles present
   # - Settings intact
   ```

4. **Clean up:**
   ```bash
   docker compose down
   rm -rf ~/stdout-test
   ```

---

## Backup Best Practices

### 3-2-1 Rule
- **3 copies** of your data (production + 2 backups)
- **2 different media** (local disk + NAS/cloud)
- **1 offsite** (cloud storage or remote server)

### Example Setup

```
Production: ~/stdout-data (live data)
Backup 1:   /mnt/nas/backups/stdout (daily automated)
Backup 2:   ~/backups/stdout (weekly manual)
Backup 3:   s3://my-bucket/stdout (monthly offsite)
```

### Retention Policy

| Backup Type | Frequency | Retention |
|-------------|-----------|-----------|
| **Daily** | Every day 2:30 AM | 30 days |
| **Weekly** | Sunday 3:00 AM | 12 weeks |
| **Monthly** | 1st of month | 12 months |
| **Yearly** | Jan 1 | 5 years |

### What to Backup

✅ **Always backup:**
- `stdout.db` (primary database)
- `stdout.db-shm` (shared memory file)
- `stdout.db-wal` (write-ahead log)
- `.env` (configuration)
- `docker-compose.yml` (deployment config)

⚠️ **Consider backing up:**
- Uploaded files (if any)
- Custom knowledge base packs
- Integration credentials

❌ **Skip:**
- `tmp/` directory
- Log files (regenerated)
- Cache files

---

## Upgrade Path

When upgrading StdOut to a new version:

1. **Backup first:**
   ```bash
   docker compose down
   tar czf stdout-pre-upgrade-$(date +%Y%m%d).tar.gz -C ~/stdout-data .
   ```

2. **Pull new image:**
   ```bash
   docker compose pull
   ```

3. **Start with new version:**
   ```bash
   docker compose up -d
   ```

4. **Verify upgrade:**
   ```bash
   # Check logs for migration messages
   docker compose logs -f stdout
   
   # Verify in browser
   open http://localhost:8112
   ```

5. **If upgrade fails, rollback:**
   ```bash
   docker compose down
   
   # Restore pre-upgrade backup
   rm -rf ~/stdout-data/*
   tar xzf stdout-pre-upgrade-*.tar.gz -C ~/stdout-data
   
   # Pin to old version in docker-compose.yml
   # Change: image: charlieseay/stdout:latest
   # To:     image: charlieseay/stdout:v1.0.0
   
   docker compose up -d
   ```

---

## Backup Scripts

### Simple Daily Backup

```bash
#!/bin/bash
# Save as: ~/bin/stdout-backup.sh

BACKUP_DIR=~/backups/stdout
mkdir -p $BACKUP_DIR

docker compose -f ~/docker-compose.yml down
tar czf $BACKUP_DIR/stdout-$(date +%Y%m%d).tar.gz -C ~/stdout-data .
docker compose -f ~/docker-compose.yml up -d

# Keep last 30 backups
ls -t $BACKUP_DIR/stdout-*.tar.gz | tail -n +31 | xargs -r rm
```

### Cloud Upload (S3)

```bash
#!/bin/bash
# Requires AWS CLI: apt install awscli

BACKUP_FILE=stdout-$(date +%Y%m%d-%H%M%S).tar.gz
tar czf /tmp/$BACKUP_FILE -C ~/stdout-data .

aws s3 cp /tmp/$BACKUP_FILE s3://my-backup-bucket/stdout/

rm /tmp/$BACKUP_FILE
```

### Encrypted Backup

```bash
#!/bin/bash
# Requires GPG

BACKUP_FILE=stdout-$(date +%Y%m%d).tar.gz
ENCRYPTED_FILE=$BACKUP_FILE.gpg

tar czf /tmp/$BACKUP_FILE -C ~/stdout-data .
gpg --symmetric --cipher-algo AES256 /tmp/$BACKUP_FILE

mv /tmp/$ENCRYPTED_FILE ~/backups/stdout/
rm /tmp/$BACKUP_FILE
```

---

## FAQ

**Q: Can I backup while StdOut is running?**  
A: Yes, SQLite WAL mode allows safe concurrent reads. Use `.backup` command or copy with rsync.

**Q: How big are StdOut backups?**  
A: Varies by usage:
- Fresh install: ~5MB (database schema + community packs)
- 100 incidents + 50 KB articles: ~20MB
- 1,000 incidents + 500 KB articles: ~100MB

**Q: Can I backup to Google Drive / Dropbox?**  
A: Yes! Use rclone or native sync tools. Example:
```bash
rclone copy ~/backups/stdout gdrive:StdOut-Backups
```

**Q: Do I need to backup the Docker image?**  
A: No. Images are versioned on Docker Hub. Only backup your data.

**Q: How do I test my backup?**  
A: Restore to a test directory, change port in compose file, start container, verify data.

**Q: What if I lose my license key?**  
A: Check purchase email or contact hello@seayniclabs.com for re-issue.

---

## Support

**Need help with backups?**
- Email: hello@seayniclabs.com
- GitHub Issues: https://github.com/seayniclabs/stdout/issues
- Documentation: https://github.com/seayniclabs/stdout/blob/main/README.md

---

**Last updated:** 2026-08-16  
**Version:** 1.0
