#!/bin/bash
set -e

# Test Discovery Scan with Monitor Creation (ThinkPad)
# Run this AFTER registering a user at http://192.168.0.244:8112/app/register

echo "=== StdOut Discovery Scan Test (ThinkPad) ==="
echo ""

# Step 1: Check user exists
echo "[1/4] Checking for user on ThinkPad..."
USER_COUNT=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM users;"')
if [ "$USER_COUNT" = "0" ]; then
  echo "❌ No users found - please register at http://192.168.0.244:8112/app/register first"
  open "http://192.168.0.244:8112/app/register"
  exit 1
fi

USER_EMAIL=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT email FROM users LIMIT 1;"')
echo "✅ Found user: ${USER_EMAIL}"
echo ""

# Step 2: Check current state
echo "[2/4] Checking current state..."
HOSTS_BEFORE=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM discovered_hosts;"')
ENTITIES_BEFORE=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM entities;"')
MONITORS_BEFORE=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM monitors;"')

echo "   Discovered hosts: $HOSTS_BEFORE"
echo "   Entities: $ENTITIES_BEFORE"
echo "   Monitors: $MONITORS_BEFORE"
echo ""

# Step 3: Instructions for authenticated scan
echo "[3/4] To run discovery scan:"
echo ""
echo "   Open http://192.168.0.244:8112/app/hud in browser and login"
echo "   Then run this in browser console:"
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
read -p "   Press Enter after running the scan..."
echo ""

# Step 4: Check results
echo "[4/4] Checking results..."
sleep 2

HOSTS_AFTER=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM discovered_hosts;"')
ENTITIES_AFTER=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM entities;"')
MONITORS_AFTER=$(ssh charlie@192.168.0.244 'docker compose -f ~/stdout-deploy/docker-compose.yml exec -T stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM monitors;"')

echo "   Discovered hosts: $HOSTS_BEFORE → $HOSTS_AFTER (+$(($HOSTS_AFTER - $HOSTS_BEFORE)))"
echo "   Entities: $ENTITIES_BEFORE → $ENTITIES_AFTER (+$(($ENTITIES_AFTER - $ENTITIES_BEFORE)))"
echo "   Monitors: $MONITORS_BEFORE → $MONITORS_AFTER (+$(($MONITORS_AFTER - $MONITORS_BEFORE)))"
echo ""

# Verification
if [ $HOSTS_AFTER -gt $HOSTS_BEFORE ]; then
  echo "✅ Network discovery working"

  if [ $MONITORS_AFTER -gt $MONITORS_BEFORE ]; then
    echo "✅ Monitor creation working! Created $(($MONITORS_AFTER - $MONITORS_BEFORE)) ping monitors"
  else
    echo "❌ Monitor creation failed - no new monitors despite $(($HOSTS_AFTER - $HOSTS_BEFORE)) new hosts"
  fi
else
  echo "⚠️  No new hosts discovered"
fi

echo ""
echo "=== Test Complete ==="
