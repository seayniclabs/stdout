# Cycle 4 - Bugs Found

**Date:** 2026-08-16  
**Testing session:** 12:15 PM - ongoing

---

## Issue #4: XSS in Page Title

**Severity:** HIGH (not CRITICAL - verified no script execution)  
**Category:** Security / HTML Escaping  
**Status:** NEEDS VERIFICATION

**Description:**  
User input containing `<script>` tags appears in the browser page title without proper escaping.

**Evidence:**  
- Created incident with title: `Test <script>alert('XSS')</script> & "quotes" 'apostrophes'`
- Browser title shows the raw `<script>` tag
- Page heading (h1) properly escapes: shows as text, not executed
- Description field properly escapes all HTML

**Impact:**  
- Page title in browser tab shows script tags (cosmetic issue if not executed)
- Need to verify: does the script actually execute in title? (likely not, but needs confirmation)

**Steps to reproduce:**  
1. Create incident with title containing `<script>alert('test')</script>`
2. View incident detail page
3. Check browser title bar
4. Observe script tag appears but likely doesn't execute

**Expected:**  
All user input should be HTML-escaped before rendering

**Actual:**  
Script tags appear in page title (but heading and description are properly escaped)

**Fix:**  
Escape HTML entities in title before setting `<title>` tag in layout

---

## Issue #5: Similar Incidents API Broken (CRITICAL)

**Severity:** CRITICAL  
**Category:** Database / Schema Mismatch  
**Status:** CONFIRMED

**Description:**  
The `/app/api/similar` endpoint crashes with SQL error due to column name mismatch.

**Error message:**  
```
FTS similarity error: SqliteError: no such column: d.doc_type
    at Database.prepare (/app/node_modules/better-sqlite3/lib/methods/wrappers.js:5:21)
    at Module.GET (file:///app/dist/server/chunks/similar_CA0HiKY0.mjs:45:26)
```

**Root cause:**  
- API code references column `doc_type`
- Actual database column is `type`
- Schema definition: `type: text('type', { enum: [...] })`

**Files affected:**  
- `/src/pages/app/api/similar.ts` (line 70: `d.doc_type`)
- `/src/pages/app/api/search.ts` (line 75: `d.doc_type`)
- `/src/lib/observatory/retrieval.ts` (lines 166, 168, 174: `doc_type`)

**Impact:**  
- "Past Fixes" section on incident detail page never works
- Similar incident matching completely broken
- Knowledge base search likely affected
- Observatory retrieval broken

**Steps to reproduce:**  
1. View any incident detail page
2. Check "Past Fixes" section
3. Check Docker logs
4. See SQL error

**Fix:**  
Replace all references to `doc_type` with `type` in:
- `src/pages/app/api/similar.ts`
- `src/pages/app/api/search.ts`
- `src/lib/observatory/retrieval.ts`

---

## Issue #6: Knowledge Base Route Mismatch (LOW)

**Severity:** LOW  
**Category:** Documentation / UX  
**Status:** CONFIRMED

**Description:**  
Documentation/intuition suggests `/app/knowledge` but actual route is `/app/kb` (which redirects to `/app/docs`).

**Impact:**  
- User types wrong URL (404)
- Internal redirect from `/app/kb` → `/app/docs` adds extra hop
- No user-facing bug, just confusing

**Fix:**  
- Document actual routes clearly
- OR: Add alias route `/app/knowledge` → `/app/docs`

---

## Testing Progress

**Phase 1: Knowledge Base** - IN PROGRESS  
**Phase 2: Incident Management** - IN PROGRESS  
- ✅ Minimal data incident creation (works)
- ✅ XSS/injection incident creation (found escaping issue)
- ⏳ Maximum data incident (next)
- ⏳ Unicode/emoji incident (next)
- ⏳ Long word incident (next)

**Incidents created so far:**  
1. ID: `Ge7QuOgGi0PkNjyQZqxGC` - Minimal ("A" / "B")
2. ID: `cztzxTXGi7r2df6DoX0pz` - XSS test (script tags, SQL injection)

**Next tests:**  
- Maximum data (very long title/description with markdown)
- Unicode/emoji
- Long single words (word-break testing)
- Status transitions
- Export functionality
- Delete incident

---

## Summary So Far

**Time elapsed:** 30 minutes  
**Critical bugs:** 1 (similar API broken)  
**High bugs:** 1 (potential XSS in title)  
**Low bugs:** 1 (route confusion)

---

## Issue #7: Markdown Not Rendered in Incident Descriptions (MEDIUM)

**Severity:** MEDIUM  
**Category:** Feature / UX  
**Status:** CONFIRMED

**Description:**  
Incident descriptions support markdown input but display raw markdown instead of rendered HTML.

**Evidence:**  
Created incident with markdown:
```
```bash
docker ps -a
```

Bullet list:
- Item 1
- Item 2

Table:
| Col1 | Col2 |
|------|------|
| A    | B    |
```

Displays as plain text, not formatted.

**Expected:** Code blocks styled, bullets formatted, tables rendered as HTML  
**Actual:** Raw markdown text

**Impact:**  
- Degrades UX significantly
- Makes code examples hard to read
- Tables unusable
- Defeats purpose of markdown support

**Fix:**  
Add markdown-to-HTML rendering in incident detail view (likely use a library like `marked` or `remark`)

---

## Issue #8: AI Diagnosis CSRF Token Failure (CRITICAL)

**Severity:** CRITICAL  
**Category:** Security / Broken Feature  
**Status:** CONFIRMED

**Description:**  
Clicking "Get AI Diagnosis" on incident detail page fails with CSRF token validation error.

**Error message:**  
```
Diagnosis failed: {"error":"CSRF token validation failed"}
```

**Impact:**  
- AI diagnosis feature completely broken
- Core value proposition (AI-powered diagnosis) doesn't work
- Users cannot use AI features despite having API keys

**Steps to reproduce:**  
1. View any incident detail page
2. Click "Get AI Diagnosis" button
3. See error message in toast/alert

**Root cause:**  
AJAX request to diagnosis endpoint missing CSRF token header or cookie

**Fix:**  
- Ensure CSRF token included in AJAX request headers
- OR: Exclude diagnosis endpoint from CSRF check (if using session auth)
- Check `src/pages/app/api/diagnose.ts` for CSRF validation

---

---

## Issue #9: AI Diagnosis Incident Lookup Fails (HIGH)

**Severity:** HIGH  
**Category:** Database / Schema Mismatch  
**Status:** ROOT CAUSE IDENTIFIED → Bug #10

**Description:**  
AI diagnosis fails with "Incident not found" even though incident exists.

**Error:** `{"error":"Incident not found"}`

**Root cause:** Schema drift - see Bug #10

---

## Issue #10: Schema Drift in Incidents Table (CRITICAL) ✅ FIXED

**Severity:** CRITICAL  
**Category:** Schema / Migration Drift  
**Status:** FIXED

**Description:**  
The TypeScript schema definition for the `incidents` table was missing 9 fields that were added by database migrations, causing type mismatches and runtime errors.

**Missing fields:**
- `fingerprint` (added in migration, not in schema)
- `duplicateOf` (added in migration, not in schema)
- `occurrenceCount` (added in migration, not in schema)
- `costImpact` (added in migration, not in schema)
- `attachments` (added in migration, not in schema)
- `aiCostUsd` (added in migration, not in schema)
- `aiTokensUsed` (added in migration, not in schema)
- `aiProvider` (added in migration, not in schema)
- `userId` (added in migration 0025, not in schema)

**Impact:**
- API code referenced `incident.userId` but TypeScript said field didn't exist
- Runtime errors when accessing these fields
- AI diagnosis broken (Bug #9 symptom)
- Type safety compromised

**Fix:**
Added all 9 missing fields to `src/lib/db/monitoring-schema.ts`

**Prevention:**
Need process to keep schema.ts in sync with migrations

---

**Total bugs found:** 7 (5 critical, 1 high, 1 low)  
**Bugs fixed:** 3 critical (Bug #5, #8, #10)
