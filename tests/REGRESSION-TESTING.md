# Regression Testing Guide

This directory contains automated regression tests for StdOut that prevent previously fixed bugs from reoccurring.

## Test Suites

### 1. Playwright Regression Tests (`regression-2026-08-17.spec.ts`)

**Traditional Playwright tests** that run against a local instance.

```bash
# Run all regression tests
npm test -- regression-2026-08-17.spec.ts

# Run a specific test
npm test -- regression-2026-08-17.spec.ts -g "Bug #1"
```

**Note:** Requires local database setup. If tests fail with "no such table: users", you need to:
1. Set up a test database with the schema
2. Run migrations against the test database
3. OR use the Chrome DevTools MCP test approach instead (see below)

### 2. Chrome DevTools MCP Tests (`regression-devtools-2026-08-17.ts`)

**Agent-driven tests** using Chrome DevTools MCP for browser automation.

These tests run against the **deployed instance** (ThinkPad at 192.168.68.89:8112), not a local dev server.

**To run:**
Ask Claude Code to execute the test suite:
```
Run the regression tests using Chrome DevTools MCP against the ThinkPad deployment
```

Claude will use the `mcp__chrome-devtools__*` tools to navigate pages, take screenshots, and verify functionality.

**Advantages:**
- Tests actual production environment
- No local database setup required
- Uses same automation as manual QA
- Can capture screenshots for failures

### 3. Manual Test Checklist (`run-regression-tests.md`)

Detailed test cases with step-by-step instructions for manual QA.

Use this when:
- Automated tests fail and you need to reproduce manually
- Testing a new environment/deployment
- Verifying fixes before writing automated tests

## What These Tests Cover

All **6 bugs found during 2026-08-17 systematic testing session:**

1. **Bug #1** - Infrastructure page HTTP 500 error (commit 444557b)
2. **Bug #2** - Network discovery saving 0 hosts (commit da83f7a)
3. **Bug #3** - Topology map CSP blocking (commit 96ae437)
4. **Bug #4** - Stack timestamps showing year 58597 (commit 498db58)
5. **Bug #5** - Host timestamps Invalid Date (commit 498db58)
6. **Bug #6** - Device discovered Invalid Date (commit e966c6b)

Plus **5 additional pages** verified working after fixes:
- Dashboard
- Incidents workflow
- Observatory
- Alerts
- Settings

## When to Run These Tests

### Before Every Release
Run full regression suite to verify no bugs have been reintroduced.

### After Schema Changes
Especially important for timestamp-related changes (Bugs #4, #5, #6).

### After Security/CSP Changes
Verify external resources still load correctly (Bug #3).

### Weekly CI Run
Catch any drift in deployed environments.

## CI/CD Integration

### Option 1: Playwright (Local Tests)
Add to GitHub Actions:
```yaml
- name: Run regression tests
  run: npm test -- regression-2026-08-17.spec.ts
```

### Option 2: Chrome DevTools MCP (Deployed Tests)
Run as a scheduled job that hits the deployed instance:
```bash
# Via Claude Code agent
claude-agent run tests/regression-devtools-2026-08-17.ts
```

## Test Results Logging

All test runs should log:
- Timestamp
- Environment (local/ThinkPad/production)
- Test results (passed/failed)
- Screenshots for failures
- Commit SHA being tested

## Troubleshooting

### "No such table: users" Error
The test database needs schema initialization. Either:
1. Run against deployed instance using Chrome DevTools MCP tests
2. Set up local test database (see `tests/setup-test-db.ts`)

### CSP Errors in Tests
Verify D3.js is loading from `cdn.jsdelivr.net`, not `d3js.org`.

### Timestamp Bugs Reoccur
Check that all schema timestamp fields use `{ mode: 'timestamp_ms' }`, not `{ mode: 'timestamp' }`.

See lesson: `Projects/StdOut/Lessons/drizzle-timestamp-mode-seconds-vs-milliseconds.md`

## Adding New Regression Tests

When a new bug is found and fixed:

1. **Add test case** to `regression-2026-08-17.spec.ts` (or create new suite for new date)
2. **Document the bug** in the test comments (root cause, fix commit)
3. **Update this README** with the new test count
4. **Run test suite** to verify it catches the bug before the fix
5. **Verify test passes** after applying the fix

## Resources

- **Testing session log:** `/Projects/StdOut/TESTING-SESSION-2026-08-17.md`
- **Drizzle timestamp lesson:** `/Projects/StdOut/Lessons/drizzle-timestamp-mode-seconds-vs-milliseconds.md`
- **Chrome DevTools MCP docs:** https://github.com/anthropics/chrome-devtools-mcp
