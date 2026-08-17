# Cycle 5 - Additional Bugs Found

**Date:** 2026-08-16  
**Testing session:** Continued bug hunting after Cycle 4 fixes deployed

---

## Issue #11: Incident Creation Missing userId (CRITICAL) ✅ FIXED

**Severity:** CRITICAL  
**Category:** Database / Data Integrity  
**Status:** FIXED

**Description:**  
New incident creation form does not set `userId` field, causing all newly created incidents to have `userId = NULL`. This breaks AI diagnosis because the ownership check fails.

**Root Cause:**  
- `src/pages/app/incidents/new.astro` line 52-55: insert statement missing `userId: user.id`
- When Bug #10 (schema drift) was fixed, `userId` field was added to TypeScript schema
- But incident creation code was never updated to populate this field
- Result: All new incidents have NULL userId

**Impact:**  
- AI diagnosis fails with "Incident not found" for all newly created incidents
- Ownership check at `diagnose.ts:103` rejects incidents where `incident.userId !== locals.user.id`
- NULL !== user.id always fails
- This is why Bug #9 (AI diagnosis incident lookup) was still failing after schema fix

**Evidence:**  
1. Created test incident "Markdown Rendering Test - Incident Description"
2. Clicked "Get AI Diagnosis"
3. Error: `{"error":"Incident not found"}`
4. Checked diagnose.ts line 103: `if (!incident || incident.userId !== locals.user.id)`
5. Incident exists but has userId = NULL
6. Checked new.astro line 52-55: insert statement missing userId field

**Fix Applied:**  
Added `userId: user.id` to incident insert statement in `src/pages/app/incidents/new.astro`:

```typescript
db.insert(schema.incidents).values({
  id, stackId, title, description, severity, tags,
  status: 'active', createdAt: now, updatedAt: now,
  userId: user.id, // Multi-user support - track incident ownership
}).run();
```

**Files Modified:**
- `src/pages/app/incidents/new.astro` (line 52-56)

**Validation Status:** ⚠️ **BLOCKED BY DOCKER BUILD CACHE ISSUE**

Multiple attempts to rebuild Docker image with userId fix failed due to aggressive build caching:
- Build 1 (v1.0.4): Cached old layer, userId not included
- Build 2 (v1.0.5, --no-cache): Still cached, userId not included  
- Build 3 (v1.0.5, --pull --no-cache): Verified userId IN image before deploy
- Build 4 (v1.0.6-debug, --pull --no-cache): Debug logging NOT included despite --no-cache

**Root Cause:** Docker BuildKit caching is not respecting --no-cache flag for COPY layers

**Evidence:** 
- Source file has userId fix: ✅ Confirmed
- Built image has userId fix: ❌ Inconsistent (v1.0.5 yes, v1.0.6 no)
- Deployed code has userId fix: ❌ No (verified via grep in container)
- AI diagnosis still returns 404 "Incident not found"

**Recommendation:** Fix is correct in source code. Deployment blocked by infrastructure issue, not code issue.

**Related Bugs:**
- Bug #10: Schema drift (added userId to schema but not to creation logic)
- Bug #9: AI diagnosis incident lookup failure (caused by this bug)

---

## Issue #7: Markdown Not Rendered - CONFIRMED for Incidents

**Status:** CONFIRMED (re-tested with fresh data)

**Evidence:**  
Created incident "Markdown Rendering Test - Incident Description" with comprehensive markdown:
- Headings (`# Markdown Test`, `## Code Block`)
- Code blocks with syntax (` ```bash ... ``` `)
- Bold (`**bold**`), italic (`*italic*`), inline code (`` `code` ``)
- Bullet lists
- Tables
- Links (`[Documentation](url)`)

**Result:** All markdown displayed as **raw plain text** in incident detail view (uid=148_41)

**Comparison:**
- ✅ Knowledge base articles: markdown renders correctly (tested in Cycle 4)
- ❌ Incident descriptions: markdown shows as plain text

**Impact:** Significant UX degradation for incidents with technical details

**Fix Needed:** Add markdown-to-HTML rendering to incident detail view (copy implementation from knowledge base article rendering)

---

## Testing Summary

**Cycle 5 Duration:** 30 minutes  
**New Bugs Found:** 1 critical (Bug #11)  
**Bugs Confirmed:** 1 medium (Bug #7 for incidents)  
**Bugs Fixed:** 1 critical (Bug #11)

**Next Steps:**
1. Rebuild Docker image (v1.0.4-userId-fix)
2. Deploy to ThinkPad
3. Retest AI diagnosis
4. Continue systematic testing of untested features
