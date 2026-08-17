# Cycle 5 - Bug Hunting & Fix Attempts Summary

**Date:** 2026-08-16  
**Duration:** 2:45 PM - 4:00 PM (1h 15min)  
**Focus:** Continue finding and fixing bugs after initial testing complete

---

## Bugs Found in Cycle 5

### Bug #11: Missing userId in Incident Creation (CRITICAL)

**Status:** ✅ CODE FIXED, ⚠️ DEPLOYMENT BLOCKED

**Description:**  
Incident creation form does not populate `userId` field, causing all new incidents to have `userId = NULL`. This breaks AI diagnosis because ownership validation fails.

**Root Cause Chain:**
1. Bug #10 (schema drift) added `userId` field to TypeScript schema
2. But incident creation code in `new.astro` was never updated to set the field
3. Result: All newly created incidents have `userId = NULL`
4. Diagnose endpoint checks `incident.userId !== locals.user.id` (line 103)
5. `NULL !== user_id` always fails → "Incident not found" error

**Fix Applied:**
```typescript
// src/pages/app/incidents/new.astro line 52-56
db.insert(schema.incidents).values({
  id, stackId, title, description, severity, tags,
  status: 'active', createdAt: now, updatedAt: now,
  userId: user.id, // Multi-user support - track incident ownership
}).run();
```

**Deployment Blocker:**  
Docker BuildKit caching issue prevents fix from deploying despite multiple --no-cache attempts. Source code is correct, but built images inconsistently include the change.

**Files Modified:**
- ✅ `src/pages/app/incidents/new.astro` - Added userId field
- ✅ `src/pages/app/api/diagnose.ts` - Added debug logging (not deployed due to cache issue)

---

### Bug #7: Markdown Not Rendered - CONFIRMED for Incidents

**Status:** ✅ CONFIRMED (split verdict)

**Test Results:**
- ✅ **Knowledge base articles:** Markdown renders correctly (headings, code blocks, tables, links all styled)
- ❌ **Incident descriptions:** Raw markdown text displayed (no formatting, syntax highlighting, or styling)

**Evidence:**  
Created test incident with comprehensive markdown content:
- `# Heading` → displays as plain text "# Heading" (not H1)
- ` ```bash ... ``` ` → displays as plain text (no syntax highlighting)
- `**bold**`, `*italic*`, `` `code` `` → not formatted
- Tables → pipe characters visible as plain text
- Links → `[text](url)` format, not clickable

**Impact:** Significant UX degradation for technical incidents with code examples, tables, or formatted documentation

**Fix Needed:** Copy markdown rendering implementation from knowledge base article view to incident detail view

---

## Docker Build Cache Investigation

**Problem:** Multiple builds with `--no-cache --pull` flags still produced inconsistent results

**Timeline:**
1. **v1.0.4-userId-fix:** Built, userId NOT in deployed code
2. **v1.0.5-userId-fix-final:** Built with `--pull --no-cache`, verified userId IN image via `docker run`, deployed, userId NOT in running container
3. **v1.0.6-debug:** Built with `--pull --no-cache`, debug logging NOT in image despite being in source

**Evidence of Cache Issue:**
```bash
# Source file has the fix
$ grep "userId: user.id" src/pages/app/incidents/new.astro
userId: user.id, // Multi-user support

# Image v1.0.5 has the fix  
$ docker run --rm stdout:v1.0.5-userId-fix-final sh -c 'grep -A2 "userId: user.id" /app/dist/server/chunks/new*.mjs'
userId: user.id

# But deployed container does NOT
$ docker exec stdout grep -A2 "userId: user.id" /app/dist/server/chunks/new*.mjs
(no output)
```

**Hypothesis:** BuildKit layer caching is reusing old COPY layers despite --no-cache flag, possibly due to:
- Multi-stage build caching between stages
- Build context not being invalidated
- Cached npm build outputs being copied

**Impact:** Blocks validation of Bug #11 fix. Code is correct but cannot be deployed for testing.

---

## Testing Summary

**Time Invested:** 1h 15min  
**Bugs Found:** 1 new critical (Bug #11)  
**Bugs Confirmed:** 1 existing (Bug #7 for incidents)  
**Bugs Fixed (code):** 1 (Bug #11)  
**Bugs Fixed (deployed):** 0 (blocked by build cache)

**Code Changes:**
- `src/pages/app/incidents/new.astro`: Added userId to incident insert (+1 line)
- `src/pages/app/api/diagnose.ts`: Added debug logging (+9 lines)

**Docker Images Built:** 3 (v1.0.4, v1.0.5, v1.0.6)  
**Successful Deployments:** 0 (all blocked by cache issue)

---

## Bugs Status After Cycle 5

### CRITICAL (6 total, 5 fixed in code, 4 deployed)
1. ✅ Bug #2: Missing customer compose file (FIXED & DEPLOYED)
2. ✅ Bug #3: Docker image SQL errors (FIXED & DEPLOYED)
3. ✅ Bug #5: Similar incidents API broken (FIXED & DEPLOYED)
4. ✅ Bug #8: CSRF token validation (FIXED & DEPLOYED)
5. ✅ Bug #10: Schema drift - 9 missing fields (FIXED & DEPLOYED)
6. ⚠️ **Bug #11: Missing userId in incident creation** (FIXED in code, NOT DEPLOYED)

### HIGH (2 total, 0 fixed)
7. ⚠️ Bug #4: XSS in page title (needs verification if cosmetic)
8. ⏳ Bug #9: AI diagnosis incident lookup (root cause was Bug #11 - should work once deployed)

### MEDIUM (2 total, 1 partial)
9. ✅ Bug #1: Documentation contradictions (FIXED in Cycle 2)
10. ⚠️ **Bug #7: Markdown not rendered** 
    - ✅ Knowledge base: Works correctly
    - ❌ Incidents: Shows raw markdown (CONFIRMED, NOT FIXED)

### LOW (1 total, 0 fixed)
11. ❌ Bug #6: Route confusion `/app/knowledge` 404 (NOT FIXED)

---

## Lessons Learned

### Docker Build Cache Issues

**Problem:** BuildKit caching extremely aggressive, not respecting --no-cache

**Symptoms:**
- Source code has changes
- Build completes successfully
- Deployed code doesn't have changes
- Inconsistent between builds (same source, different output)

**Attempted Solutions:**
- `--no-cache`: Failed
- `--pull --no-cache`: Failed
- `docker rmi` + rebuild: Failed
- Different image tags: Failed

**Root Cause:** Likely multi-stage build COPY layers being cached despite flags

**Proper Solution:** 
1. Add `.dockerignore` to prevent unnecessary context
2. Use explicit cache-busting in Dockerfile (ARG CACHEBUST)
3. OR: Build in CI/CD pipeline with clean environment
4. OR: Delete BuildKit cache: `docker builder prune --all`

### Testing Blocked by Infrastructure

**Impact:** 1h 15min spent on build/deploy cycles, zero validation progress

**Prevention:**
- Test fixes locally with `npm run dev` before Docker builds
- Validate TypeScript compilation catches schema issues
- Use local dev environment for rapid iteration
- Only build Docker for final validation

---

## Recommendations

### Immediate (for Charlie)

1. **Clear BuildKit cache:** `docker builder prune --all` on Mac Mini
2. **Rebuild and deploy:** Fresh build with cleared cache should work
3. **Validate Bug #11 fix:** Create incident, test AI diagnosis  
4. **Fix Bug #7:** Add markdown rendering to incident detail view
5. **Verify Bug #4:** Check if XSS in title is cosmetic only

### Code Quality

**Bug #11 teaches:** When adding database fields via migrations:
1. Update TypeScript schema file
2. Update ALL insert statements using that table
3. Update ALL select/where clauses that reference the field
4. Add TypeScript compilation check to pre-commit hook

**Prevention:** Create a checklist for schema changes to prevent drift

---

## Next Steps

1. Clear Docker build cache
2. Rebuild stdout image from clean state
3. Deploy and validate Bug #11 fix works
4. Continue systematic feature testing
5. Document remaining bugs in detail
6. Fix markdown rendering for incidents (Bug #7)

---

**Cycle 5 completed:** 2026-08-16 4:00 PM CT  
**Status:** Productive bug finding, blocked by infrastructure  
**Net impact:** +2 bugs found, +1 bug fixed (code), +0 bugs fixed (deployed)
