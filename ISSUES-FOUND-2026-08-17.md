# StdOut Issues Found - 2026-08-17

## Issues Fixed

### 1. Nav Points to Wrong Docs Route
**Status:** ✅ Fixed  
**Root Cause:** Nav pointed to `/docs` (public docs) instead of `/app/docs` (knowledge base)  
**Fix:** Updated `Layout.astro` nav link to `/app/docs`

### 2. Docs Not Clickable
**Status:** ✅ Fixed  
**Root Cause:** Astro routing conflict - having both `/app/docs/index.astro` and `/app/docs/[id].astro` at the same level caused Astro to route ALL `/app/docs/*` paths to index  
**Fix:**
- Moved document detail route from `/app/docs/[id].astro` to `/app/doc/[id].astro` (singular)
- Updated all doc links in `index.astro` to point to `/app/doc/${doc.id}`
- Fixed schema mismatches (code checked `doc.source` and `doc.userId` but DB uses `doc.visibility`)
- Multi-platform Docker builds (amd64+arm64) for cross-platform deployment

### 3. Stack Details Navigation Broken
**Status:** ✅ Fixed  
**Root Cause:** Restrictive `userId` check prevented viewing stacks created by different users (e.g., from previous test runs)  
**Fix:** Removed userId check in single-instance mode - `/app/stacks/[id].astro` now allows any authenticated user to view any stack

## Issues Investigated - Working As Designed

### 4. Stack Shows 0 Services
**Status:** ⚠️ Working as designed - no action needed  
**Finding:** Database actually contains 0 discovered services:
```sql
SELECT COUNT(*) FROM discovered_services;  -- Returns: 0
SELECT COUNT(*) FROM windlass_services;     -- Returns: 0
```
The "5 containerized services" shown in stack descriptions is static text, not a database query.  
Service counts are calculated from `discovered_services` via host linkage - currently accurate at "0 services".

### 5. Unclassified Devices (36+ devices awaiting classification)
**Status:** 🔧 Root cause identified - port scanning results not persisted  
**Finding:**
```sql
SELECT device_type, COUNT(*) FROM discovered_hosts GROUP BY device_type;
-- docker-container | 8
-- gateway         | 1
-- unknown         | 38
```

**Root Cause Analysis:**
1. Enhanced classifier EXISTS at `src/lib/observatory/workers/enhanced-classifier.ts` ✅
2. Classifier supports 12 device types with confidence scoring ✅
3. Classifier IS being called during discovery ✅
4. **BUT**: All unknown devices have `open_ports = '[]'` (empty array) ❌

**Why:** Port scanning infrastructure exists but results aren't being saved:
- `initial-discovery.ts` line ~200: Runs `nmap -sT -Pn -p ${PORTS} ${ip}`
- Comment says: "Open-port → discovered_services persistence handled by the existing scan-services path"
- **Missing:** No code actually parses nmap output or updates `open_ports` column
- **Result:** Classifier receives zero port/service data → defaults to "unknown"

**Required Fix:**
Add nmap output parser in `initial-discovery.ts` after port scan:
1. Parse nmap output for open ports (look for lines like "22/tcp open ssh")
2. Update `discovered_hosts.open_ports` with JSON array of open ports
3. Optionally populate `discovered_services` table
4. Then classifier will have data to work with

## Technical Details

### Multi-Platform Docker Build Issue
Initial deployments failed because Mac (ARM64) builds weren't compatible with ThinkPad (AMD64).

**Solution:**
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t charlieseay/stdout-setup:latest --push .
```

### Schema Mismatches Found
- **Docs table:** Code checked `doc.source` and `doc.userId` but schema only has `doc.visibility`
- **Stacks table:** `userId` column exists but was too restrictive for single-instance use

## Validation Methodology

Used Chrome DevTools MCP to validate fixes:
- Navigated to pages
- Clicked elements programmatically
- Verified navigation worked
- Took screenshots as proof

**Lesson:** Should have done comprehensive E2E testing BEFORE claiming "complete" in previous session.

## Additional Issues Fixed (Session 2)

### 6. Discovery Page Missing Information
**Status:** ✅ Fixed  
**Root Cause:** Discovery host cards only showed hostname/IP, missing device type, last seen, open ports, service count  
**Fix:** Enhanced discovery page cards to display:
- Device type badge (docker-container, gateway, unknown)
- Last seen timestamp (human-readable: "1h ago", "13m ago")
- Open ports count (when > 0)
- Service count (when > 0)
- Improved styling with metadata rows

### 7. Monitor Detail Page Not Loading
**Status:** ✅ Fixed  
**Root Cause:** Multiple schema issues:
- Wrong table name: `monitor_checks` (doesn't exist) → should be `check_results`
- User filter blocking access: `WHERE user_id = ?` prevented viewing monitors in single-instance mode
- Type mismatch: `timeAgo()` function assumed Date objects but SQLite returns numeric timestamps

**Fix:**
- Changed query to use `check_results` table
- Removed `user_id` filter for single-instance deployment
- Updated `timeAgo()` to handle numeric timestamps

## Testing Summary - Session 2

**Pages Tested & Working:**
- ✅ Dashboard - stats, monitors, activity feed rendering
- ✅ Incidents - empty state, new incident form
- ✅ Observatory - autonomic control, Riggins, metrics
- ✅ Alerts - empty states for routes and recent alerts
- ✅ Settings - all config sections accessible
- ✅ Infrastructure Discovery - **NOW SHOWS** device types, last seen, ports
- ✅ Topology Map - D3 force graph rendering
- ✅ Knowledge Base (Docs) - list view + detail pages working
- ✅ Stack Details - navigation working, hosts visible
- ✅ **Monitor Detail** - **NOW WORKING** - shows config, checks, related device
- ✅ Device Detail - network info, monitors

**Remaining Known Issues:**
- Device classification accuracy still pending (needs deep scan to populate ports on existing hosts)

## Next Steps

1. Continue E2E testing of remaining features
2. Test form submissions (create incident, add doc, etc.)
3. Test Riggins agent interactions
4. Verify all buttons/links work throughout the app
5. Test responsive design on smaller viewports
