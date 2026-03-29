---
title: "SQLite Backup Strategy for Containerized Apps"
type: runbook
tags: sqlite, backup, docker, data-safety, automation
---

## Purpose

Prevent data loss for self-hosted apps that use SQLite (Vaultwarden, Miniflux, n8n, Mealie, and dozens of others). SQLite is a single file, which makes backups simple — but also makes them easy to get wrong.

## The Problem with Naive Copies

You can't just `cp database.db database.db.bak` while the app is running. SQLite uses a write-ahead log (WAL) and shared memory files (`-wal` and `-shm`). Copying the main file without these produces a corrupt backup. Even with WAL, copying during a write transaction can catch the file in an inconsistent state.

## Method 1: SQLite Online Backup (Recommended)

The `.backup` command creates a consistent snapshot even while the database is in use:

```bash
sqlite3 /path/to/database.db ".backup '/path/to/backup/database-$(date +%Y%m%d).db'"
```

This works because SQLite's backup API takes a read lock, copies pages atomically, and retries if a write occurs during the copy. The result is always a consistent database.

### Scripted Version

```bash
#!/bin/bash
BACKUP_DIR="/path/to/backups/sqlite"
TIMESTAMP=$(date +%Y%m%d-%H%M)
RETENTION_DAYS=14

# List of databases to back up
declare -A DATABASES=(
  ["vaultwarden"]="/volumes/data/containers/vaultwarden/data/db.sqlite3"
  ["miniflux"]="/volumes/data/containers/miniflux/data/miniflux.db"
  ["mealie"]="/volumes/data/containers/mealie/data/mealie.db"
)

mkdir -p "$BACKUP_DIR"

for name in "${!DATABASES[@]}"; do
  src="${DATABASES[$name]}"
  dest="$BACKUP_DIR/${name}-${TIMESTAMP}.db"

  if [ -f "$src" ]; then
    sqlite3 "$src" ".backup '${dest}'"
    echo "OK: $name → $dest ($(du -h "$dest" | cut -f1))"
  else
    echo "SKIP: $name — file not found at $src"
  fi
done

# Prune old backups
find "$BACKUP_DIR" -name "*.db" -mtime +$RETENTION_DAYS -delete
echo "Pruned backups older than $RETENTION_DAYS days"
```

### Running Inside Docker

If `sqlite3` isn't installed on the host, exec into the container:

```bash
docker exec vaultwarden sqlite3 /data/db.sqlite3 ".backup '/data/backup.db'"
docker cp vaultwarden:/data/backup.db /path/to/backups/vaultwarden-$(date +%Y%m%d).db
docker exec vaultwarden rm /data/backup.db
```

## Method 2: Stop-and-Copy (Simple, More Downtime)

For services that can tolerate a few seconds of downtime:

```bash
docker stop myapp
cp /path/to/database.db /path/to/backup/database-$(date +%Y%m%d).db
cp /path/to/database.db-wal /path/to/backup/database-$(date +%Y%m%d).db-wal 2>/dev/null
docker start myapp
```

Copy the WAL file too if it exists. This method is foolproof but causes downtime.

## Schedule

Run backups automatically. On macOS:

```bash
# Create a launchd plist at ~/Library/LaunchAgents/com.lab.sqlite-backup.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lab.sqlite-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/sqlite-backup.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

Load it: `launchctl load ~/Library/LaunchAgents/com.lab.sqlite-backup.plist`

On Linux, a cron job: `0 3 * * * /path/to/sqlite-backup.sh`

## Verification

A backup you haven't tested is not a backup. After each run:

```bash
# Check integrity
sqlite3 /path/to/backup/database-20260329.db "PRAGMA integrity_check;"
# Expected: ok

# Check it has data
sqlite3 /path/to/backup/database-20260329.db "SELECT count(*) FROM some_table;"
```

Add the integrity check to your backup script so it runs automatically.

## Restore

```bash
docker stop myapp
cp /path/to/backup/database-20260329.db /path/to/database.db
rm -f /path/to/database.db-wal /path/to/database.db-shm
docker start myapp
```

Remove the WAL and SHM files when restoring — they belong to the old database state and will cause corruption if left in place.

## Lessons Learned

I lost a Vaultwarden database once because I was copying the file while the container was running. The backup looked fine (right file size, recent timestamp) but was silently corrupt. The integrity check would have caught it. Now every backup script includes `PRAGMA integrity_check` as a post-step, and I test restores quarterly.
