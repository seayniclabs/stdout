#!/bin/bash
# StdOut Initialization Script
# Runs on first container start to auto-configure everything

set -e

echo "[init] StdOut initialization starting..."

# Create data directories if missing
mkdir -p /data
mkdir -p /data/backups
echo "[init] Data directories ensured"

# Check if this is first run (no setup_progress table or no admin user)
DB_PATH="${DATABASE_PATH:-${DB_PATH:-/data/central.db}}"

if [ ! -f "$DB_PATH" ]; then
  echo "[init] First run detected - database does not exist yet"
  echo "[init] Setup wizard will initialize on first web access"
else
  echo "[init] Database exists at $DB_PATH"

  # Check if we need to create an admin user from env vars
  USER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users" 2>/dev/null || echo "0")

  if [ "$USER_COUNT" = "0" ] && [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "[init] No users found - creating admin user from environment variables..."
    node /app/scripts/create-admin-from-env.js
  fi

  # Check if setup is complete
  SETUP_COMPLETE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM setup_progress WHERE step_number = 8 AND completed = 1" 2>/dev/null || echo "0")

  if [ "$SETUP_COMPLETE" = "0" ]; then
    echo "[init] Setup not yet complete - wizard will run on web access"
  else
    echo "[init] Setup already complete"

    # Auto-connect to Windlass if available and not already connected
    if [ -n "$WINDLASS_URL" ]; then
      echo "[init] Checking Windlass availability at $WINDLASS_URL..."
      if curl -sf "$WINDLASS_URL/health" > /dev/null 2>&1; then
        echo "[init] ✓ Windlass is available"
        # TODO: Auto-sync Windlass registry
      else
        echo "[init] ✗ Windlass not reachable (this is okay, continuing without it)"
      fi
    fi

    # Auto-connect to Observatory Sentinel if available
    if [ -n "$SENTINEL_API_URL" ]; then
      echo "[init] Checking Observatory Sentinel at $SENTINEL_API_URL..."
      if curl -sf "$SENTINEL_API_URL/health" > /dev/null 2>&1; then
        echo "[init] ✓ Observatory Sentinel is available"
      else
        echo "[init] ✗ Observatory Sentinel not reachable (this is okay, continuing without it)"
      fi
    fi
  fi
fi

echo "[init] Initialization complete"
echo "[init] Starting StdOut web server..."
