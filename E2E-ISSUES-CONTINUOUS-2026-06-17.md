# StdOut Continuous E2E Validation - Issues Log

**Session Start:** 2026-06-17  
**Goal:** Clean → Install → E2E → Fix → Repeat until 100% complete  
**Method:** Chrome DevTools automation  

---

## Iteration 1 - Clean Deployment

### Deployment Status
- ✅ Deployed: ghcr.io/seayniclabs/stdout:latest
- Method: docker compose (fixed secrets → env vars)
- ThinkPad: 192.168.0.244:8112
- Setup wizard: ✅ Completed (all 7 steps)
- Installation: ❌ Failed with errors

### Issues Found

#### ISSUE #1: Setup wizard completes but redirects back to /app/setup (P0 BLOCKER) ✅ FIXED & VERIFIED
**Found:** 2026-06-17 22:10 UTC  
**Fixed:** 2026-06-17 22:20 UTC (commit f541b3f)  
**Verified:** 2026-06-17 22:23 UTC (clean install + retest)

**Steps to reproduce:**
1. Complete full setup wizard (all 7 steps)
2. Click "Start Installation" on final setup page
3. Installation completes with errors (see #3, #4)
4. Navigate to /app → redirects back to /app/setup

**Expected:** Dashboard loads  
**Actual (before fix):** Stuck in setup loop, cannot access application

**Root cause:** Missing `getDb` import in `src/pages/app/api/setup/install-stream.ts` line 166 prevented `installation_complete` flag from being set in `system_state` table, causing middleware to redirect all `/app` requests to `/app/setup`

**Fix:** Added `import { getDb } from '../../../../lib/db'` before use

**Verification result:** ✅ Dashboard loads successfully at http://192.168.0.244:8112/app after setup completes

---

#### ISSUE #2: Scanner import fails with HTTP 500 during setup (P1)
**Found:** 2026-06-17 22:06 UTC (setup wizard step 4)  
**Steps:**
1. Click "Scan All Networks" in setup wizard
2. Scan completes: "Found 33 host(s)"
3. UI shows "Importing discovered hosts..."
4. UI shows "Import failed: 500"

**Expected:** Hosts imported into database  
**Actual:** HTTP 500 error, no hosts imported

**Additional:** Direct POST to `/api/scanner/scan` returns 403 Forbidden (auth required)

---

#### ISSUE #3: Installation step "Data Source Discovery" fails with "getDb is not defined" (P1) ✅ FIXED & VERIFIED
**Found:** 2026-06-17 22:08 UTC (automated installation step)  
**Fixed:** 2026-06-17 22:20 UTC (commit f541b3f)  
**Verified:** 2026-06-17 22:23 UTC (retest shows step completes)

**Log (before fix):**
```
[00:02:12] ▶ Starting: Data Source Discovery
[00:02:12] ✗ Failed: Data Source Discovery
[00:02:12] ⚠ getDb is not defined
```

**Fix:** Changed `import { getCentralDb }` to `import { getDb }` in `src/lib/setup/data-sources.ts` line 138

**Verification result:** ✅ Step completes successfully - "Found 2 running containers"

---

#### ISSUE #4: Installation step "Monitor Configuration" fails with "getDb is not defined" (P1) ✅ FIXED
**Found:** 2026-06-17 22:08 UTC (automated installation step)  
**Fixed:** 2026-06-17 22:20 UTC (commit f541b3f)
**Log (before fix):**
```
[00:02:12] ▶ Starting: Monitor Configuration
[00:02:12] ✗ Failed: Monitor Configuration
[00:02:12] ⚠ getDb is not defined
```

**Fix:** Added `import { getDb } from '../db'` to `src/lib/setup/monitors.ts` line 34

**Verification:** Installation now completes, but reveals new issue #5 (schema error)

---

#### ISSUE #5: Monitor Configuration fails with "no such column: type" (P2) ⏳ NEW
**Found:** 2026-06-17 22:23 UTC (during retest after fix)  
**Log:**
```
[00:00:09] ▶ Starting: Monitor Configuration
[00:00:09] ✗ Failed: Monitor Configuration
[00:00:09] ⚠ no such column: type
```

**Expected:** Query stacks table successfully  
**Actual:** SQL error - `type` column doesn't exist in stacks table

**Root cause:** Schema mismatch - `src/lib/setup/monitors.ts` line 42 queries `SELECT id, name, type FROM stacks` but stacks table doesn't have `type` column

**Status:** Documented, not yet fixed

---

## Test Coverage Tracker

| Section | Tests | Status | Issues |
|---------|-------|--------|--------|
| Installation | 6 | ❌ Blocked | #1, #3, #4 |
| Authentication | 5 | ⏳ Pending | Blocked by #1 |
| Dashboard | 6 | ⏳ Pending | Blocked by #1 |
| HUD | 13 | ⏳ Pending | Blocked by #1 |
| Incidents | 12 | ⏳ Pending | Blocked by #1 |
| Infrastructure | 7 | ⏳ Pending | Blocked by #1 |
| Knowledge Base | 5 | ⏳ Pending | Blocked by #1 |
| Security | 7 | ⏳ Pending | Blocked by #1 |
| Settings | 10 | ⏳ Pending | Blocked by #1 |
| Windlass | 7 | ⏳ Pending | Blocked by #1 |
| Observatory | 10 | ⏳ Pending | Blocked by #1 |
| Network Topology | 9 | ⏳ Pending | Blocked by #1 |
| Final Verification | 7 | ⏳ Pending | Blocked by #1 |

**Total:** 0/104 tests complete (ALL BLOCKED by setup redirect loop)

---

## Known Placeholder Features

### Security Page
- **Status:** Placeholder only
- **Current:** "Coming Soon" message
- **Missing:**
  - Audit log viewer
  - CVE vulnerability scanning
  - Security compliance reports
  - Access control management
  - TLS certificate monitoring
  - Failed authentication tracking

### Community Knowledge Base
- **Status:** Feature removed (P2-1 fix)
- **Current:** User docs only
- **Missing:**
  - `source` column in schema
  - Community docs filtering
  - Public/shared docs

### Observatory
- **Status:** Unknown - needs verification
- **Needs Testing:**
  - AI watcher agent functionality
  - Anomaly detection
  - Auto-incident creation
  - Prometheus/Loki/Tempo integration

### Windlass
- **Status:** Unknown - needs verification  
- **Needs Testing:**
  - Schedule-aware management
  - Service start/stop
  - Memory optimization
  - n8n integration

---

## Fix Tracking

### Iteration 1 Fixes
*To be populated*

---

## Next Actions

1. Wait for deployment to complete
2. Run setup wizard via Chrome DevTools
3. Execute full E2E test suite
4. Document EVERY issue found
5. Fix ALL issues
6. Checkpoint
7. REPEAT
