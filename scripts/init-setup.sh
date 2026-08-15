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
# DB_PATH is the single source of truth — must match src/lib/db/index.ts (self-host uses /data/stdout.db)
DB_PATH="${DB_PATH:-${DATABASE_PATH:-/data/stdout.db}}"

if [ ! -f "$DB_PATH" ]; then
  echo "[init] First run detected - database does not exist yet"
  echo "[init] Setup wizard will initialize on first web access"
else
  echo "[init] Database exists at $DB_PATH"

  # Check if we need to create/update an admin user from env vars
  USER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users" 2>/dev/null || echo "0")

  # Zero-touch (unattended) install path: ADMIN_EMAIL + ADMIN_PASSWORD provided.
  # Create the admin and complete setup automatically — no browser wizard, no manual SQL.
  UNATTENDED=0
  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    UNATTENDED=1
  fi

  if [ "$UNATTENDED" = "1" ]; then
    if [ "$USER_COUNT" = "0" ]; then
      echo "[init] No users found - creating admin user from environment variables..."
      node /app/scripts/create-admin-from-env.js
    else
      # Users exist - check if admin user with ADMIN_EMAIL exists
      ADMIN_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE email = '$ADMIN_EMAIL'" 2>/dev/null || echo "0")
      if [ "$ADMIN_EXISTS" = "1" ]; then
        echo "[init] Admin user exists - updating password from environment variables..."
        node /app/scripts/update-admin-password.js
      else
        echo "[init] Creating admin user from environment variables..."
        node /app/scripts/create-admin-from-env.js
      fi
    fi
  fi

  # In unattended mode, mark setup complete automatically (idempotent).
  if [ "$UNATTENDED" = "1" ]; then
    echo "[init] Unattended mode - completing setup automatically..."
    node /app/scripts/bootstrap-unattended.js
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
      # Give Windlass a moment to come up (compose starts both together)
      WINDLASS_UP=0
      for i in 1 2 3 4 5 6; do
        if curl -sf "$WINDLASS_URL/health" > /dev/null 2>&1; then
          WINDLASS_UP=1
          break
        fi
        sleep 2
      done
      if [ "$WINDLASS_UP" = "1" ]; then
        echo "[init] ✓ Windlass is available"
        echo "[init] Auto-configuring Windlass integration..."
        node /app/scripts/create-windlass-config-from-env.js
      else
        echo "[init] ✗ Windlass not reachable yet (app will retry config at runtime)"
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
