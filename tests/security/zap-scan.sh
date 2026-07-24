#!/bin/bash
# OWASP ZAP Security Scan for StdOut
#
# Runs automated security testing against StdOut application
# Tests for OWASP Top 10 vulnerabilities
#
# Prerequisites: Docker (ZAP runs in container)
# Usage: ./tests/security/zap-scan.sh [target_url]

set -euo pipefail

TARGET_URL=${1:-"http://host.docker.internal:4321"}
REPORT_DIR="$(pwd)/test-results/security"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$REPORT_DIR"

echo "🔍 Starting OWASP ZAP security scan"
echo "Target: ${TARGET_URL}"
echo "Report dir: ${REPORT_DIR}"
echo ""

# Run ZAP baseline scan in Docker
docker run --rm \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t "${TARGET_URL}" \
  -r "zap-report-${TIMESTAMP}.html" \
  -J "zap-report-${TIMESTAMP}.json" \
  -w "zap-report-${TIMESTAMP}.md" \
  -c zap-config.conf

echo ""
echo "✅ Scan complete"
echo "HTML report: ${REPORT_DIR}/zap-report-${TIMESTAMP}.html"
echo "JSON report: ${REPORT_DIR}/zap-report-${TIMESTAMP}.json"
echo "Markdown report: ${REPORT_DIR}/zap-report-${TIMESTAMP}.md"
