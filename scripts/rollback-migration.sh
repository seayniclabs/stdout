#!/bin/bash
#
# Rollback Migration Script
# Restores database from backup if migration fails or causes issues
#
# Usage: ./rollback-migration.sh /path/to/backup.db /path/to/current.db
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BACKUP_PATH="$1"
DB_PATH="$2"

if [ -z "$BACKUP_PATH" ] || [ -z "$DB_PATH" ]; then
    echo -e "${RED}Usage: $0 <backup-file> <database-file>${NC}"
    echo ""
    echo "Example:"
    echo "  $0 /data/stdout-pre-migration-20260722-123456.db /data/stdout.db"
    exit 1
fi

if [ ! -f "$BACKUP_PATH" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_PATH${NC}"
    exit 1
fi

echo -e "${YELLOW}=== StdOut Database Rollback ===${NC}"
echo "Backup: $BACKUP_PATH"
echo "Current: $DB_PATH"
echo ""
echo -e "${RED}WARNING: This will replace your current database with the backup!${NC}"
echo "All data since the backup was created will be lost."
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Rollback cancelled."
    exit 0
fi

echo ""
echo "Creating safety backup of current state..."
SAFETY_BACKUP="${DB_PATH}.before-rollback-$(date +%Y%m%d-%H%M%S)"
cp "$DB_PATH" "$SAFETY_BACKUP"
echo -e "${GREEN}✓${NC} Safety backup created: $SAFETY_BACKUP"

echo ""
echo "Restoring from backup..."
cp "$BACKUP_PATH" "$DB_PATH"
echo -e "${GREEN}✓${NC} Database restored"

echo ""
echo "Verifying integrity..."
if sqlite3 "$DB_PATH" "PRAGMA integrity_check" | grep -q "ok"; then
    echo -e "${GREEN}✓${NC} Database integrity OK"
else
    echo -e "${RED}✗${NC} Database integrity check failed!"
    echo "Restoring from safety backup..."
    cp "$SAFETY_BACKUP" "$DB_PATH"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Rollback completed successfully! ===${NC}"
echo ""
echo "Your database has been restored to:"
echo "  $(date -r "$BACKUP_PATH" '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "Safety backup of replaced database:"
echo "  $SAFETY_BACKUP"
echo ""
echo "Next step: Restart StdOut container"
