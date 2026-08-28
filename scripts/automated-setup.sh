#!/bin/bash
set -e

# StdOut Automated Setup Script
# Completes the setup wizard programmatically for E2E testing
#
# Usage:
#   ./scripts/automated-setup.sh [TARGET_HOST]
#
# Example:
#   ./scripts/automated-setup.sh 192.168.68.89:8112

TARGET_HOST="${1:-192.168.68.89:8112}"
BASE_URL="http://${TARGET_HOST}"

# Test credentials (from HANDOFF.md and test suite)
ADMIN_EMAIL="charlie@seayniclabs.com"
ADMIN_PASSWORD="Stdout2026!"
ADMIN_NAME="Charlie Seay"
ENV_NAME="Production Lab"
LICENSE_KEY="STDOUT-SELFHOST-2026"  # Self-host dev license

echo "================================"
echo "StdOut Automated Setup"
echo "================================"
echo "Target: ${BASE_URL}"
echo "Email: ${ADMIN_EMAIL}"
echo ""

# Step 1: Create admin account
echo "[1/4] Creating admin account..."
SETUP_RESPONSE=$(curl -s -X POST "${BASE_URL}/app/api/setup/admin" \
  -H "Content-Type: application/json" \
  -d "{
    \"displayName\": \"${ADMIN_NAME}\",
    \"email\": \"${ADMIN_EMAIL}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }")

if echo "$SETUP_RESPONSE" | grep -q "success"; then
  echo "  ✅ Admin account created"
else
  echo "  ⚠️  Response: $SETUP_RESPONSE"
  # Check if user already exists
  if echo "$SETUP_RESPONSE" | grep -q "exists\|duplicate"; then
    echo "  ℹ️  Admin account already exists, continuing..."
  else
    echo "  ❌ Failed to create admin account"
    exit 1
  fi
fi

# Step 2: Name environment
echo "[2/4] Naming environment..."
ENV_RESPONSE=$(curl -s -X POST "${BASE_URL}/app/api/setup/environment" \
  -H "Content-Type: application/json" \
  -d "{
    \"workspaceName\": \"${ENV_NAME}\",
    \"accentColor\": \"#6366F1\"
  }")

if echo "$ENV_RESPONSE" | grep -q "success"; then
  echo "  ✅ Environment named: ${ENV_NAME}"
else
  echo "  ⚠️  Response: $ENV_RESPONSE"
fi

# Step 3: Activate license (or skip)
echo "[3/4] Activating license..."
LICENSE_RESPONSE=$(curl -s -X POST "${BASE_URL}/app/api/setup/license" \
  -H "Content-Type: application/json" \
  -d "{
    \"licenseKey\": \"${LICENSE_KEY}\",
    \"skip\": false
  }")

if echo "$LICENSE_RESPONSE" | grep -q "success\|valid"; then
  echo "  ✅ License activated: ${LICENSE_KEY}"
else
  echo "  ⚠️  License activation failed, skipping..."
  # Skip license step
  SKIP_RESPONSE=$(curl -s -X POST "${BASE_URL}/app/api/setup/license/skip" \
    -H "Content-Type: application/json" \
    -d '{"skip": true}')
  echo "  ℹ️  License skipped (offline mode)"
fi

# Step 4: Mark setup complete
echo "[4/4] Marking setup complete..."
COMPLETE_RESPONSE=$(curl -s -X POST "${BASE_URL}/app/api/setup/complete" \
  -H "Content-Type: application/json" \
  -d '{}')

if echo "$COMPLETE_RESPONSE" | grep -q "success\|complete"; then
  echo "  ✅ Setup marked complete"
else
  echo "  ⚠️  Response: $COMPLETE_RESPONSE"
fi

echo ""
echo "================================"
echo "✅ Setup Complete!"
echo "================================"
echo ""
echo "Login at: ${BASE_URL}/app/login"
echo "Email: ${ADMIN_EMAIL}"
echo "Password: ${ADMIN_PASSWORD}"
echo ""
echo "⏳ Waiting 30 seconds for workers to start..."
sleep 30

echo ""
echo "Checking worker status..."
echo ""

# Verify workers started
echo "🔍 Checking container logs for worker startup..."
if command -v ssh &> /dev/null && [[ "$TARGET_HOST" == "192.168.68.89"* ]]; then
  ssh thinkpad "docker logs stdout 2>&1" | grep -E "Setup complete|Observatory|discovery|workers" | tail -20
else
  echo "  ℹ️  Run manually: docker logs stdout | grep -E 'Setup complete|Observatory|workers'"
fi

echo ""
echo "🔍 Checking database for discoveries (wait 5 min for first scan)..."
echo "  Run: docker exec stdout sqlite3 /app/data/stdout.db 'SELECT COUNT(*) FROM discovered_hosts;'"
echo ""
echo "✅ Automated setup complete!"
