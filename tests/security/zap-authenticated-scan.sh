#!/bin/bash
# OWASP ZAP Authenticated Scan
#
# Scans protected routes after authentication
# Requires StdOut admin credentials
#
# Usage: ./tests/security/zap-authenticated-scan.sh

set -euo pipefail

TARGET_URL="http://host.docker.internal:4321"
REPORT_DIR="$(pwd)/test-results/security"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ZAP_SESSION="stdout-authenticated-${TIMESTAMP}.session"

mkdir -p "$REPORT_DIR"

echo "🔍 Starting authenticated ZAP scan"
echo "Target: ${TARGET_URL}"
echo ""

# Start ZAP daemon
docker run --rm -d \
  --name zap-scan \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  -p 8090:8090 \
  ghcr.io/zaproxy/zaproxy:stable zap.sh -daemon \
  -host 0.0.0.0 -port 8090 -config api.disablekey=true

echo "Waiting for ZAP to start..."
sleep 10

# Configure authentication context via ZAP API
echo "Configuring authentication..."
curl -s "http://localhost:8090/JSON/authentication/action/setAuthenticationMethod/" \
  -d "contextId=0" \
  -d "authMethodName=formBasedAuthentication" \
  -d "authMethodConfigParams=loginUrl=${TARGET_URL}/app/login&loginRequestData=email%3D{%25username%25}%26password%3D{%25password%25}"

# Set credentials
curl -s "http://localhost:8090/JSON/users/action/newUser/" \
  -d "contextId=0" \
  -d "name=admin"

curl -s "http://localhost:8090/JSON/users/action/setAuthenticationCredentials/" \
  -d "contextId=0" \
  -d "userId=0" \
  -d "authCredentialsConfigParams=username%3Dadmin@stdout.local%26password%3DAdmin123!secure"

# Start scan
echo "Starting authenticated spider..."
curl -s "http://localhost:8090/JSON/spider/action/scan/" \
  -d "url=${TARGET_URL}/app" \
  -d "contextName=Default Context" \
  -d "recurse=true"

# Wait for spider to complete
while [ "$(curl -s 'http://localhost:8090/JSON/spider/view/status/')" != '{"status":"100"}' ]; do
  echo "Spider progress: $(curl -s 'http://localhost:8090/JSON/spider/view/status/' | grep -o '[0-9]\+')"
  sleep 5
done

echo "Starting active scan..."
SCAN_ID=$(curl -s "http://localhost:8090/JSON/ascan/action/scan/" \
  -d "url=${TARGET_URL}/app" | grep -o '"[0-9]\+"' | tr -d '"')

# Wait for scan to complete
while [ "$(curl -s "http://localhost:8090/JSON/ascan/view/status/?scanId=${SCAN_ID}")" != '{"status":"100"}' ]; do
  echo "Scan progress: $(curl -s "http://localhost:8090/JSON/ascan/view/status/?scanId=${SCAN_ID}" | grep -o '[0-9]\+')"
  sleep 10
done

# Generate reports
echo "Generating reports..."
curl -s "http://localhost:8090/OTHER/core/other/htmlreport/" \
  > "${REPORT_DIR}/zap-auth-report-${TIMESTAMP}.html"

curl -s "http://localhost:8090/JSON/core/view/alerts/" \
  > "${REPORT_DIR}/zap-auth-report-${TIMESTAMP}.json"

# Cleanup
docker stop zap-scan

echo ""
echo "✅ Authenticated scan complete"
echo "HTML report: ${REPORT_DIR}/zap-auth-report-${TIMESTAMP}.html"
echo "JSON report: ${REPORT_DIR}/zap-auth-report-${TIMESTAMP}.json"
