# E2E Test Issues Found

**Test Session:** 2026-06-17  
**Environment:** ThinkPad (192.168.0.244:8112)  
**Docker Image:** charlieseay/stdout:latest  
**Method:** Clean slate installation + Chrome DevTools MCP browser automation  

---

## Critical Issues (P0)

### ❌ P0-1: Scanner endpoint missing
**Severity:** P0 (blocks scanner functionality)  
**Component:** Scanner API  
**Impact:** "Run Scan Now" button fails silently - scanner cannot populate entities table needed for network topology  

**Root Cause:**  
- `/api/scanner/run-now` tries to call `/api/scanner/scan` but this endpoint doesn't exist
- Only `/api/discovery/scan` exists (the comprehensive scanner that populates entities table)
- Scanner button triggers non-existent endpoint → silent failure

**Evidence:**
- Network map shows "DEVICES: 0, SERVICES: 0, MONITORS: 0, CONNECTIONS: 0" despite database having discovered_hosts
- `entities` table: 0 rows (should have device entities from scan)
- `discovered_hosts` table: 1 row (populated by Scanner discovery)
- `monitors` table: 2 rows (auto-created from discovered_hosts)

**Fix Applied:**  
Created `/src/pages/app/api/scanner/scan.ts` that forwards to `/api/discovery/scan` with default options:
- ARP scan: enabled
- mDNS scan: enabled
- SSDP scan: enabled
- Vendor lookup: enabled
- Create entities: true
- Create monitors: true

**Commit:** c841476  
**Status:** Fixed, awaiting retest after clean redeploy  
**Testing:** Will verify "Run Scan Now" populates entities table and network map shows devices

---

## High Priority (P1)

*(None found yet - testing in progress)*

---

## Medium Priority (P2)

*(None found yet - testing in progress)*

---

## Low Priority (P3)

*(None found yet - testing in progress)*

---

## Test Progress

**Installation (6 tests):** ✅ COMPLETE  
**Authentication (5 tests):** ✅ COMPLETE  
**Observatory (10 tests):** ✅ COMPLETE  
**Scanner (8 tests):** ⏸️ IN PROGRESS (found P0-1, fixing before continuing)  
**Network Topology (9 tests):** ⏸️ BLOCKED (waiting for scanner fix)  
**HUD (13 tests):** ⏭️ PENDING  
**Incidents (12 tests):** ⏭️ PENDING  
**Dashboard (6 tests):** ⏭️ PENDING  
**Infrastructure (7 tests):** ⏭️ PENDING  
**Settings (10 tests):** ⏭️ PENDING  
**Windlass (7 tests):** ⏭️ PENDING  
**Knowledge Base (5 tests):** ⏭️ PENDING  
**Security (7 tests):** ⏭️ PENDING  
**Final Verification (7 tests):** ⏭️ PENDING  

**Total:** ~25/140 tests complete (~18%)

---

## Next Actions

1. ✅ Fix P0-1 scanner endpoint (commit c841476)
2. ✅ Build new Docker image
3. ✅ Push to Docker Hub
4. ⏳ Clean redeploy on ThinkPad
5. ⏭️ Retest Scanner discovery with new image
6. ⏭️ Continue E2E testing through all 140+ test cases
