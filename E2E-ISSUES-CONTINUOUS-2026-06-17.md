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

#### ISSUE #5: Monitor Configuration fails with "no such column: type" (P2) ✅ FIXED
**Found:** 2026-06-17 22:23 UTC (during retest after fix)  
**Confirmed:** 2026-06-17 23:30 UTC (Docker Hub image test)
**Fixed:** 2026-06-17 23:35 UTC (commit 35cf9d6)

**Log:**
```
[00:00:09] ▶ Starting: Monitor Configuration
[00:00:09] ✗ Failed: Monitor Configuration
[00:00:09] ⚠ no such column: type
```

**Expected:** Query stacks table successfully  
**Actual:** SQL error - `type` column doesn't exist in stacks table

**Root cause:** Schema mismatch - `src/lib/setup/monitors.ts` line 42 queries `SELECT id, name, type FROM stacks` but stacks table doesn't have `type` column

**Fix:** Removed `type` from SELECT query in monitors.ts line 42

**Status:** Fixed and committed, awaiting deployment verification

---

#### ISSUE #6: Scanner UI doesn't update after scan completion (P2) ✅ FIXED
**Found:** 2026-06-17 23:28 UTC (Docker Hub deployment test)  
**Fixed:** 2026-06-17 23:35 UTC (commit 35cf9d6)

**Steps:**
1. Complete setup wizard through Step 4 - Scanner
2. Click "Scan All Networks"
3. Scanner completes: "Found 37 host(s)"
4. Button still shows "Scanning..." (disabled)
5. No "Import All Hosts" or "Continue" button appears

**Expected:** After scan completes, button updates or auto-redirects  
**Actual:** Button stays as "Scanning..." indefinitely, UI doesn't reflect completion

**Root cause:** Import API was failing with HTTP 500 (see ISSUE #7), scanner UI never received success callback to update button state

**Fix:** 
1. Added button re-enable logic on import failure in scanner.astro
2. Fixed root cause (ISSUE #7) - missing schema imports in import API

**Status:** Fixed and committed, awaiting deployment verification

---

#### ISSUE #7: Network import API missing schema references (P2) ✅ FIXED
**Found:** 2026-06-17 23:35 UTC (root cause analysis of ISSUE #6)  
**Fixed:** 2026-06-17 23:35 UTC (commit 35cf9d6)

**Root cause:** `src/pages/app/api/network/import.ts` referenced `stacks`, `discoveredHosts`, `discoveredServices` without importing them from schema

**Impact:** 
- Import API always returned HTTP 500
- Scanner workflow blocked (couldn't import discovered hosts)
- Setup wizard scanner step unusable

**Fix:** Added destructured schema imports:
```typescript
const { stacks, discoveredHosts, discoveredServices } = schema;
```

**Status:** Fixed and committed, awaiting deployment verification

---

#### ISSUE #8: Windlass installation hangs during Observatory setup (P2) ⏳ OPEN
**Found:** 2026-06-17 23:29 UTC (Docker Hub deployment test)  
**Steps:**
1. Complete setup wizard through Step 6 - Windlass
2. Click "Continue" on Windlass configuration page
3. Installation starts automatically
4. Shows "Starting Observatory services..." indefinitely
5. "Installation Complete!" button remains disabled

**Expected:** Installation completes and enables Continue button  
**Actual:** Hangs on Observatory services step, never completes

**Impact:** Users cannot complete Windlass setup via wizard

**Workaround:** Force navigate to `/setup/ticketing` to skip

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

## Missing Features (From Feature Backlog + Critical Gaps)

### HIGH PRIORITY (P1) - Core Functionality Missing

#### F006: Theming and Skins System
- **Status:** Proposed (not built)
- **Location:** Feature Backlog.md
- **Scope:**
  - Settings page skin selector with grid previews
  - 5-10 built-in skins (dark/light variants)
  - Skin editor UI (color picker, preview, save)
  - Community library at stdout.seayniclabs.com/skins
  - Import/export skin JSON
  - Global application via CSS variables

#### Network Discovery - Fing-Level
- **Status:** Incomplete (only basic ARP scan)
- **Location:** CRITICAL-GAPS-2026-06-17.md #1
- **Missing:**
  - mDNS (Bonjour) - Apple devices, printers, smart speakers
  - SSDP (UPnP) - Smart TVs, media players
  - DHCP fingerprinting - OS detection
  - MAC vendor lookup - Device manufacturer
  - Banner grabbing - Service identification
  - Device profiling - Classification

#### Entity Graph Database
- **Status:** Missing
- **Location:** CRITICAL-GAPS-2026-06-17.md #2
- **Current:** Flat tables, no relationships
- **Required:**
  - `entities` table with JSON properties
  - `entity_relationships` table
  - Query API for graph traversal
  - Migrate existing data to entity model

#### Network Topology Visualization
- **Status:** Missing
- **Location:** CRITICAL-GAPS-2026-06-17.md #3
- **Required:**
  - SVG network map at `/app/network-map`
  - Live updates via WebSocket
  - Interactive nodes (click → details)
  - Auto-layout (force-directed or hierarchical)
  - Color-coded by health status
  - Export as PNG/SVG

#### Auto-Resolution System
- **Status:** Missing
- **Location:** CRITICAL-GAPS-2026-06-17.md #4
- **Issue:** Incidents never auto-resolve when monitors recover
- **Required:** Auto-resolve active incidents when monitor returns to healthy state

### MEDIUM PRIORITY (P2) - Polish & UX

#### Observatory Tools UI
- **Status:** Tools exist in containers but not exposed in UI
- **Location:** CRITICAL-GAPS-2026-06-17.md #8
- **Required:**
  - API endpoints: packet-capture, port-scan, dns-lookup
  - UI page: `/app/observatory/tools`
  - Watcher AI can invoke via tool calls

#### Windlass Integration
- **Status:** Built but not working
- **Location:** CRITICAL-GAPS-2026-06-17.md #7
- **Issue:** Shows "not configured" despite container running
- **Required:**
  - Auto-detect Windlass on localhost:8116
  - Sync n8n workflow schedules
  - Show synced services on Dashboard

#### Setup Wizard Polish
- **Status:** Functional but minimal UX
- **Location:** CRITICAL-GAPS-2026-06-17.md #6
- **Required:**
  - Animated progress (scanning → analyzing → configuring)
  - Real-time log stream (SSE)
  - Success animation on completion

### LOW PRIORITY (P3) - Nice to Have

#### F001: Skip Optional Components Toggle
- **Status:** Planned
- **Effort:** Small (< 2h)
- **Scope:** Checkbox to skip Windlass/Observatory during setup

#### F003: Scanner Token Display
- **Status:** Planned  
- **Effort:** Small
- **Scope:** Show scanner API token in setup completion screen

#### F004: Installation Resume on Error
- **Status:** Proposed
- **Effort:** Medium
- **Scope:** Resume failed installation from last successful step

---

## Next Actions

1. **Document all missing features** ✅ COMPLETE
2. **Prioritize feature backlog** ✅ COMPLETE  
3. **Create implementation plan** ⏳ NEXT
4. **Deploy fixes and verify** ⏳ WAITING
5. Continue systematic E2E testing
6. Fix critical bugs as discovered
7. Implement P1 missing features
8. REPEAT loop until 100% complete
