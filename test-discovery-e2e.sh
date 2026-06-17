#!/bin/bash
set -e

# StdOut Discovery E2E Test Script
# Tests full network discovery → entity creation → monitor creation flow

BASE_URL="http://localhost:8112"
DB_PATH="/data/stdout.db"

echo "=== StdOut Discovery E2E Test ==="
echo ""

# Step 1: Check if StdOut is running
echo "[1/6] Checking StdOut health..."
HEALTH=$(curl -s ${BASE_URL}/healthz)
if [[ $? -ne 0 ]]; then
  echo "❌ StdOut is not accessible at ${BASE_URL}"
  exit 1
fi
echo "✅ StdOut is running"
echo "$HEALTH" | jq '.'
echo ""

# Step 2: Check if user exists
echo "[2/6] Checking for existing user..."
USER_COUNT=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM users;")
echo "   Users in database: $USER_COUNT"

if [ "$USER_COUNT" = "0" ]; then
  echo "   No users found - you need to register at ${BASE_URL}/app/register first"
  echo "   Opening browser..."
  open "${BASE_URL}/app/register" || echo "   Please navigate to ${BASE_URL}/app/register manually"
  echo ""
  echo "   After registering, re-run this script."
  exit 0
fi

USER_ID=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT id FROM users LIMIT 1;")
USER_EMAIL=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT email FROM users WHERE id='${USER_ID}';")
echo "✅ Found user: ${USER_EMAIL} (${USER_ID})"
echo ""

# Step 3: Check current state
echo "[3/6] Checking current infrastructure state..."
DISCOVERED_HOSTS=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM discovered_hosts WHERE user_id='${USER_ID}';")
ENTITIES=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM entities WHERE user_id='${USER_ID}';")
MONITORS=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM monitors WHERE user_id='${USER_ID}';")
PING_MONITORS=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM monitors WHERE user_id='${USER_ID}' AND type='ping';")

echo "   Discovered hosts: $DISCOVERED_HOSTS"
echo "   Entities: $ENTITIES"
echo "   Total monitors: $MONITORS"
echo "   Ping monitors: $PING_MONITORS"
echo ""

# Step 4: Trigger discovery scan (requires authentication)
echo "[4/6] Triggering network discovery scan..."
echo "   ⚠️  This requires manual execution from authenticated session"
echo ""
echo "   Run this in your browser console while logged in:"
echo ""
echo "   fetch('/app/api/discovery/scan', {"
echo "     method: 'POST',"
echo "     headers: { 'Content-Type': 'application/json' },"
echo "     body: JSON.stringify({"
echo "       arpScan: true,"
echo "       mdnsScan: true,"
echo "       ssdpScan: true,"
echo "       vendorLookup: true,"
echo "       timeout: 15,"
echo "       createEntities: true,"
echo "       createMonitors: true"
echo "     })"
echo "   }).then(r => r.json()).then(console.log)"
echo ""
echo "   Or visit the HUD at ${BASE_URL}/app/hud and click 'AI Setup'"
echo ""
read -p "   Press Enter after running the scan..."
echo ""

# Step 5: Check results
echo "[5/6] Checking scan results..."
sleep 2  # Give DB time to write

DISCOVERED_HOSTS_AFTER=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM discovered_hosts WHERE user_id='${USER_ID}';")
ENTITIES_AFTER=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM entities WHERE user_id='${USER_ID}';")
MONITORS_AFTER=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM monitors WHERE user_id='${USER_ID}';")
PING_MONITORS_AFTER=$(docker compose exec -T stdout sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM monitors WHERE user_id='${USER_ID}' AND type='ping';")

echo "   Discovered hosts: $DISCOVERED_HOSTS → $DISCOVERED_HOSTS_AFTER (+$(($DISCOVERED_HOSTS_AFTER - $DISCOVERED_HOSTS)))"
echo "   Entities: $ENTITIES → $ENTITIES_AFTER (+$(($ENTITIES_AFTER - $ENTITIES)))"
echo "   Total monitors: $MONITORS → $MONITORS_AFTER (+$(($MONITORS_AFTER - $MONITORS)))"
echo "   Ping monitors: $PING_MONITORS → $PING_MONITORS_AFTER (+$(($PING_MONITORS_AFTER - $PING_MONITORS)))"
echo ""

# Step 6: Verify critical paths
echo "[6/6] Verifying critical paths..."

if [ $DISCOVERED_HOSTS_AFTER -gt 0 ]; then
  echo "✅ Network discovery working (found $DISCOVERED_HOSTS_AFTER hosts)"
else
  echo "❌ Network discovery failed (no hosts found)"
fi

if [ $ENTITIES_AFTER -gt 0 ]; then
  echo "✅ Entity graph populated ($ENTITIES_AFTER entities)"
else
  echo "⚠️  Entity graph empty (expected if createEntities=false)"
fi

if [ $MONITORS_AFTER -gt $MONITORS ]; then
  echo "✅ Monitor auto-creation working (+$(($MONITORS_AFTER - $MONITORS)) monitors)"
else
  echo "❌ Monitor auto-creation failed (no new monitors)"
fi

if [ $PING_MONITORS_AFTER -gt 0 ]; then
  echo "✅ Ping monitors created ($PING_MONITORS_AFTER total)"
else
  echo "⚠️  No ping monitors (expected $DISCOVERED_HOSTS_AFTER from discovered hosts)"
fi

echo ""
echo "=== Test Results ==="
echo "Discovered hosts: $DISCOVERED_HOSTS_AFTER"
echo "Entities: $ENTITIES_AFTER"
echo "Monitors: $MONITORS_AFTER"
echo "Ping monitors: $PING_MONITORS_AFTER"
echo ""
echo "Next steps:"
echo "1. Visit ${BASE_URL}/app/hud to see monitors"
echo "2. Visit ${BASE_URL}/app/network-map to see topology"
echo "3. Visit ${BASE_URL}/app/stacks to see infrastructure cards"
echo ""
