# StdOut Security Testing

OWASP ZAP automated security scans.

## Prerequisites

```bash
# Docker (ZAP runs in container)
docker pull ghcr.io/zaproxy/zaproxy:stable
```

## Scans

### 1. Baseline Scan (`zap-scan.sh`)
Quick passive scan against public routes.

**Tests:**
- OWASP Top 10 vulnerabilities
- Common misconfigurations
- Information disclosure

**Run:**
```bash
./tests/security/zap-scan.sh http://localhost:4321
```

**Duration:** ~5 minutes

### 2. Authenticated Scan (`zap-authenticated-scan.sh`)
Deep scan of protected routes after login.

**Tests:**
- Authorization bypasses
- Privilege escalation
- Session management
- CSRF protection

**Run:**
```bash
# Start StdOut first
npm run dev

# Run scan
./tests/security/zap-authenticated-scan.sh
```

**Duration:** ~15-30 minutes

## Reports

Reports are saved to `test-results/security/`:
- `zap-report-YYYYMMDD-HHMMSS.html` - Human-readable report
- `zap-report-YYYYMMDD-HHMMSS.json` - Machine-readable results
- `zap-report-YYYYMMDD-HHMMSS.md` - Markdown summary

## Interpreting Results

### Alert Levels
- **High**: Critical vulnerability, fix immediately
- **Medium**: Security weakness, should fix
- **Low**: Minor issue or best-practice violation
- **Informational**: Not a vulnerability, just info

### Common Findings (Expected)
- ✅ **Cookie without Secure flag** (dev uses HTTP, production uses HTTPS)
- ✅ **Missing HttpOnly** (intentional for CSRF token cookie)
- ✅ **CSP header** (already implemented in middleware)

### Actionable Findings
- ❌ **SQL Injection** - Verify all queries use parameterized statements
- ❌ **XSS** - Check input sanitization and output encoding
- ❌ **CSRF** - Verify token validation on all mutations
- ❌ **Auth bypass** - Check middleware coverage
- ❌ **Path traversal** - Verify file upload/download path validation

## CI Integration

Add to GitHub Actions:

```yaml
- name: OWASP ZAP Scan
  run: |
    npm run dev &
    sleep 5
    ./tests/security/zap-scan.sh http://localhost:4321
    
- name: Upload ZAP Report
  uses: actions/upload-artifact@v3
  with:
    name: zap-report
    path: test-results/security/zap-report-*.html
```

## Configuration

Edit `zap-config.conf` to:
- Ignore false positives
- Adjust alert thresholds
- Enable/disable specific checks

## Cleanup

```bash
# Stop ZAP container (if still running)
docker stop zap-scan

# Remove old reports (optional)
rm test-results/security/zap-report-*.{html,json,md}
```
