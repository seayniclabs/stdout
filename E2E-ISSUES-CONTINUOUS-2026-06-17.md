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

#### ISSUE #1: Setup wizard completes but redirects back to /app/setup (P0 BLOCKER)
**Found:** 2026-06-17 22:10 UTC  
**Steps:**
1. Complete full setup wizard (all 7 steps)
2. Click "Start Installation" on final setup page
3. Installation completes with errors (see #3, #4)
4. Navigate to /app → redirects back to /app/setup

**Expected:** Dashboard loads  
**Actual:** Stuck in setup loop, cannot access application

**Database:** User exists (stdout.db = 520KB), setup completed  
**Root cause:** Unknown — likely "setup_complete" flag not set correctly

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

#### ISSUE #3: Installation step "Data Source Discovery" fails with "getDb is not defined" (P1)
**Found:** 2026-06-17 22:08 UTC (automated installation step)  
**Log:**
```
[00:02:12] ▶ Starting: Data Source Discovery
[00:02:12] ✗ Failed: Data Source Discovery
[00:02:12] ⚠ getDb is not defined
```

**Expected:** Discover running containers as data sources  
**Actual:** ReferenceError thrown

---

#### ISSUE #4: Installation step "Monitor Configuration" fails with "getDb is not defined" (P1)
**Found:** 2026-06-17 22:08 UTC (automated installation step)  
**Log:**
```
[00:02:12] ▶ Starting: Monitor Configuration
[00:02:12] ✗ Failed: Monitor Configuration
[00:02:12] ⚠ getDb is not defined
```

**Expected:** Auto-configure monitors for discovered services  
**Actual:** ReferenceError thrown

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
