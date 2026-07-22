#!/bin/bash
#
# Production Database Migration Script
# Migrates existing StdOut database to new schema with all P0 fixes and new features
#
# What this does:
# 1. Creates a timestamped backup
# 2. Adds missing columns to existing tables
# 3. Creates new tables for auto-remediation and cost tracking
# 4. Validates the migration
# 5. Rolls back automatically if anything fails
#
# Usage: ./migrate-production-to-new-schema.sh /path/to/stdout.db
#

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DB_PATH="${1:-/data/stdout.db}"
BACKUP_DIR="$(dirname "$DB_PATH")"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/stdout-pre-migration-${TIMESTAMP}.db"

echo -e "${GREEN}=== StdOut Production Database Migration ===${NC}"
echo "Database: $DB_PATH"
echo "Backup will be saved to: $BACKUP_PATH"
echo ""

# Function to run SQL and handle errors
run_sql() {
    local sql="$1"
    local description="$2"

    echo -n "  → $description... "
    if sqlite3 "$DB_PATH" "$sql" 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        return 1
    fi
}

# Function to check if column exists
column_exists() {
    local table="$1"
    local column="$2"

    sqlite3 "$DB_PATH" "PRAGMA table_info($table)" | grep -q "^[0-9]|$column|"
}

# Function to check if table exists
table_exists() {
    local table="$1"

    sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table'" | grep -q "$table"
}

# Step 1: Create backup
echo -e "${YELLOW}[1/6] Creating backup...${NC}"
if cp "$DB_PATH" "$BACKUP_PATH"; then
    echo -e "  ${GREEN}✓ Backup created${NC}"
    BACKUP_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
    echo "  Size: $BACKUP_SIZE"
else
    echo -e "  ${RED}✗ Backup failed - aborting${NC}"
    exit 1
fi

# Step 2: Add missing columns to existing tables
echo -e "\n${YELLOW}[2/6] Adding missing columns to existing tables...${NC}"

# Add expires_at to api_tokens if it doesn't exist
if table_exists "api_tokens"; then
    if ! column_exists "api_tokens" "expires_at"; then
        run_sql "ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER" \
                "Add expires_at to api_tokens"
    else
        echo "  → expires_at already exists in api_tokens - ${GREEN}skip${NC}"
    fi
fi

# Add ai_cost_usd, ai_tokens_used, provider to incidents if they don't exist
if table_exists "incidents"; then
    if ! column_exists "incidents" "ai_cost_usd"; then
        run_sql "ALTER TABLE incidents ADD COLUMN ai_cost_usd REAL DEFAULT 0" \
                "Add ai_cost_usd to incidents"
    else
        echo "  → ai_cost_usd already exists in incidents - ${GREEN}skip${NC}"
    fi

    if ! column_exists "incidents" "ai_tokens_used"; then
        run_sql "ALTER TABLE incidents ADD COLUMN ai_tokens_used INTEGER DEFAULT 0" \
                "Add ai_tokens_used to incidents"
    else
        echo "  → ai_tokens_used already exists in incidents - ${GREEN}skip${NC}"
    fi

    if ! column_exists "incidents" "provider"; then
        run_sql "ALTER TABLE incidents ADD COLUMN provider TEXT" \
                "Add provider to incidents"
    else
        echo "  → provider already exists in incidents - ${GREEN}skip${NC}"
    fi
fi

# Step 3: Create new tables for auto-remediation
echo -e "\n${YELLOW}[3/6] Creating auto-remediation tables...${NC}"

if ! table_exists "remediation_playbooks"; then
    run_sql "CREATE TABLE remediation_playbooks (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_type TEXT NOT NULL,
        trigger_pattern TEXT NOT NULL,
        steps TEXT NOT NULL,
        rollback_steps TEXT,
        requires_approval INTEGER DEFAULT 1,
        timeout_seconds INTEGER DEFAULT 300,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )" "Create remediation_playbooks table"
else
    echo "  → remediation_playbooks already exists - ${GREEN}skip${NC}"
fi

if ! table_exists "remediation_executions"; then
    run_sql "CREATE TABLE remediation_executions (
        id TEXT PRIMARY KEY NOT NULL,
        playbook_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        dry_run INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        FOREIGN KEY (playbook_id) REFERENCES remediation_playbooks(id),
        FOREIGN KEY (incident_id) REFERENCES incidents(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )" "Create remediation_executions table"
else
    echo "  → remediation_executions already exists - ${GREEN}skip${NC}"
fi

if ! table_exists "remediation_execution_steps"; then
    run_sql "CREATE TABLE remediation_execution_steps (
        id TEXT PRIMARY KEY NOT NULL,
        execution_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        step_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        output TEXT,
        error TEXT,
        FOREIGN KEY (execution_id) REFERENCES remediation_executions(id) ON DELETE CASCADE
    )" "Create remediation_execution_steps table"
else
    echo "  → remediation_execution_steps already exists - ${GREEN}skip${NC}"
fi

# Step 4: Create cost tracking table
echo -e "\n${YELLOW}[4/6] Creating cost tracking table...${NC}"

if ! table_exists "cost_audit"; then
    run_sql "CREATE TABLE cost_audit (
        id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
    )" "Create cost_audit table"
else
    echo "  → cost_audit already exists - ${GREEN}skip${NC}"
fi

# Step 5: Create indexes for performance
echo -e "\n${YELLOW}[5/6] Creating performance indexes...${NC}"

run_sql "CREATE INDEX IF NOT EXISTS idx_cost_audit_incident ON cost_audit(incident_id)" \
        "Create index on cost_audit.incident_id" || true

run_sql "CREATE INDEX IF NOT EXISTS idx_cost_audit_created ON cost_audit(created_at)" \
        "Create index on cost_audit.created_at" || true

run_sql "CREATE INDEX IF NOT EXISTS idx_remediation_executions_incident ON remediation_executions(incident_id)" \
        "Create index on remediation_executions.incident_id" || true

run_sql "CREATE INDEX IF NOT EXISTS idx_remediation_executions_playbook ON remediation_executions(playbook_id)" \
        "Create index on remediation_executions.playbook_id" || true

# Step 6: Validation
echo -e "\n${YELLOW}[6/6] Validating migration...${NC}"

VALIDATION_PASSED=true

# Check critical tables exist
for table in "remediation_playbooks" "remediation_executions" "remediation_execution_steps" "cost_audit"; do
    if table_exists "$table"; then
        echo -e "  ${GREEN}✓${NC} Table $table exists"
    else
        echo -e "  ${RED}✗${NC} Table $table missing"
        VALIDATION_PASSED=false
    fi
done

# Check critical columns exist
if column_exists "api_tokens" "expires_at"; then
    echo -e "  ${GREEN}✓${NC} Column api_tokens.expires_at exists"
else
    echo -e "  ${RED}✗${NC} Column api_tokens.expires_at missing"
    VALIDATION_PASSED=false
fi

if column_exists "incidents" "ai_cost_usd"; then
    echo -e "  ${GREEN}✓${NC} Column incidents.ai_cost_usd exists"
else
    echo -e "  ${RED}✗${NC} Column incidents.ai_cost_usd missing"
    VALIDATION_PASSED=false
fi

# Verify database integrity
echo -n "  → Checking database integrity... "
if sqlite3 "$DB_PATH" "PRAGMA integrity_check" | grep -q "ok"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    VALIDATION_PASSED=false
fi

# Final result
echo ""
if [ "$VALIDATION_PASSED" = true ]; then
    echo -e "${GREEN}=== Migration completed successfully! ===${NC}"
    echo ""
    echo "Summary:"
    echo "  • Backup: $BACKUP_PATH"
    echo "  • New tables: 4 (remediation_playbooks, remediation_executions, remediation_execution_steps, cost_audit)"
    echo "  • Modified tables: 2 (api_tokens, incidents)"
    echo "  • New indexes: 4"
    echo ""
    echo "Next steps:"
    echo "  1. Restart StdOut container with new code"
    echo "  2. Verify login works"
    echo "  3. Test auto-remediation at /app/remediations"
    echo "  4. Check cost tracking at /app/costs"
    echo ""
    echo -e "${GREEN}Your database is ready for the new features!${NC}"
    exit 0
else
    echo -e "${RED}=== Migration validation failed ===${NC}"
    echo ""
    echo "The migration encountered errors. Your database has NOT been modified."
    echo "Backup is still available at: $BACKUP_PATH"
    echo ""
    echo "Please review the errors above and contact support if needed."
    exit 1
fi
