# StdOut Test Suite

Phase 4.1: Comprehensive testing for all features built in Phases 1-3.

## Quick Start

### Smoke Tests (Fast)

Run quick smoke tests to verify core functionality:

```bash
# Local development
./scripts/smoke-test.sh

# Remote instance
./scripts/smoke-test.sh http://192.168.68.89:8112
```

**Expected output:**
```
🧪 StdOut Smoke Test Suite
📍 Target: http://localhost:8112

[TEST] S1: App loads
[PASS] App responds with HTTP 200
[TEST] S5: Health check API
[PASS] Health API returned status:ok
...
✅ All tests passed (6/6)
```

### Full E2E Tests (Playwright)

Run comprehensive Playwright tests:

```bash
# Install dependencies
npm install

# Run all tests
npx playwright test

# Run specific test suite
npx playwright test tests/e2e/phase-4-test-suite.spec.ts

# Run with UI
npx playwright test --ui

# Run in headed mode (see browser)
npx playwright test --headed
```

## Test Suites

### S1-S6: Smoke Tests (Core Functionality)

- **S1: App loads** - Homepage returns 200
- **S2: Login/Register** - Auth flow works
- **S3: Incident CRUD** - Create, read, update, delete
- **S4: Logout** - Session cleanup
- **S5: Health check** - `/api/health` returns `{"status":"ok"}`
- **S6: No console errors** - Clean JavaScript execution

### B1-B4: Branding Tests (Phase 2)

- **B1: Setup wizard branding** - Logo upload + color picker in setup
- **B2: Settings page branding** - Change workspace name, logo, color
- **B3: Reset to defaults** - Restore StdOut branding
- **B4: Branding persists** - Custom branding shows in nav

### R1-R3: Open-Notebook RAG Tests (Phase 3)

- **R1: Document search** - Search docs by keyword
- **R2: Auto-learning** - Post-mortem generation from resolved incidents
- **R3: RAG search API** - Direct API test for search endpoint

### I1: Integration Tests

- **I1: End-to-end incident resolution** - Full workflow from creation to resolution

## Test Configuration

Edit `tests/e2e/phase-4-test-suite.spec.ts` to change:

- `BASE_URL` - Default `http://localhost:8112`
- `TEST_EMAIL` - Test user email
- `TEST_PASSWORD` - Test user password

Or set environment variables:

```bash
export TEST_URL=http://192.168.68.89:8112
npx playwright test
```

## Test Data

Tests create temporary data:
- User: `test@stdout.local`
- Incidents: Prefixed with "Test Incident"
- Workspace: "Test Lab" or "Updated Test Lab"

Clean up test data:
```bash
# Reset database (dev only!)
rm data/stdout.db
npm run db:migrate
```

## CI/CD Integration

Add to GitHub Actions:

```yaml
- name: Run smoke tests
  run: ./scripts/smoke-test.sh http://localhost:8112

- name: Run E2E tests
  run: npx playwright test
```

## Debugging Failed Tests

1. **Check logs:**
   ```bash
   docker logs stdout-stdout-1
   ```

2. **Run in headed mode:**
   ```bash
   npx playwright test --headed --debug
   ```

3. **Screenshot on failure:**
   Playwright automatically captures screenshots in `test-results/`

4. **Health check:**
   ```bash
   curl http://localhost:8112/api/health | jq
   ```

## Performance Benchmarks

Target metrics:
- Homepage load: <500ms
- API response: <100ms
- Search query: <100ms (RAG)
- Incident creation: <200ms

Run performance tests:
```bash
# Load testing with k6 (optional)
k6 run tests/performance/load-test.js
```

## Known Issues

- **B1 (Setup wizard)**: Requires fresh install - manual test only
- **R2 (Auto-learning)**: Post-mortem generation may require manual trigger
- **PostgreSQL tests**: Deferred until customer needs

## Contributing

When adding features:
1. Write tests first (TDD)
2. Run smoke tests before commit
3. Run full E2E suite before PR
4. Update this README with new test cases

## Support

- Test failures: Check `test-results/` directory
- CI issues: Review GitHub Actions logs
- Local dev: Ensure `npm install` and `docker compose up` ran
