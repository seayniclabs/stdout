#!/bin/bash
#
# Quick Smoke Test Runner
# Phase 4.1: Validates core functionality is working
#
# Usage: ./scripts/smoke-test.sh [base-url]
#

BASE_URL="${1:-http://localhost:8112}"
FAIL_COUNT=0
PASS_COUNT=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_test() {
  echo -e "${YELLOW}[TEST]${NC} $1"
}

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((PASS_COUNT++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((FAIL_COUNT++))
}

echo "🧪 StdOut Smoke Test Suite"
echo "📍 Target: $BASE_URL"
echo ""

# S1: App loads
log_test "S1: App loads"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  log_pass "App responds with HTTP $HTTP_CODE"
else
  log_fail "App returned HTTP $HTTP_CODE (expected 200 or 302)"
fi

# S2: Health check
log_test "S5: Health check API"
HEALTH=$(curl -s "$BASE_URL/api/health" | grep -o '"status":"ok"')
if [ ! -z "$HEALTH" ]; then
  log_pass "Health API returned status:ok"
else
  log_fail "Health API did not return status:ok"
fi

# S3: Static assets load
log_test "S6: Static assets"
FAVICON=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/favicon.svg")
if [ "$FAVICON" = "200" ]; then
  log_pass "Favicon loads (HTTP 200)"
else
  log_fail "Favicon missing (HTTP $FAVICON)"
fi

# S4: Login page loads
log_test "S2: Login page"
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/app/login")
if [ "$LOGIN_CODE" = "200" ]; then
  log_pass "Login page loads (HTTP 200)"
else
  log_fail "Login page returned HTTP $LOGIN_CODE"
fi

# S5: API endpoints respond
log_test "S3: API endpoints"
INCIDENTS_API=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/app/api/incidents")
if [ "$INCIDENTS_API" = "401" ] || [ "$INCIDENTS_API" = "403" ] || [ "$INCIDENTS_API" = "200" ]; then
  log_pass "Incidents API responds (HTTP $INCIDENTS_API - auth required is OK)"
else
  log_fail "Incidents API error (HTTP $INCIDENTS_API)"
fi

# S6: Database connectivity
log_test "S4: Database"
# Health endpoint also checks DB, so if that passed, DB is working
if [ ! -z "$HEALTH" ]; then
  log_pass "Database connection verified (via health check)"
else
  log_fail "Database connection issue (health check failed)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed${NC} ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC} ($FAIL_COUNT failed, $PASS_COUNT passed)"
  exit 1
fi
