# StdOut Retro Security & Code Quality Audit
Date: 2026-05-06

## Security Findings

### CRITICAL: Workspace/Team Authorization Bypass in Incident Creation
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/incidents/index.ts:86-104`
- **Issue:** The POST endpoint creates incidents using `userId: locals.user.id` (current user), but pulls the DB from `locals.workspace?.ownerId || locals.user.id`. In a team workspace, this creates an authorization paradox: a team member can create incidents in the owner's workspace without proper RBAC checks. Incident is attributed to current user but stored in owner's DB.
  - Line 86: `const userId = locals.workspace?.ownerId || locals.user.id;` (gets workspace DB)
  - Line 104: `userId: locals.user.id,` (attributes to current user)
- **Fix:** Enforce RBAC checks before incident creation: add `checkRBAC(locals, 'create')` at line 77, or validate that creation only occurs in user's own workspace, not team workspaces.

### HIGH: Missing Authorization Check on Stack Validation in Webhook
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/incidents/webhook.ts:55-62`
- **Issue:** When creating incidents with stackId via webhook, code validates stack exists but does not verify ownership. Attacker with valid Bearer token could link incidents to another user's stacks.
- **Fix:** Add ownership check: `where(and(eq(tenantSchema.stacks.id, stackId), eq(tenantSchema.stacks.userId, locals.user.id)))`.

### HIGH: FTS Search Injection via Unsanitized Query Terms
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/search.ts:26, 49, 71`
- **Issue:** FTS queries constructed from user input without full sanitization. Line 26: `const ftsQuery = q.split(/\s+/).map(w => \`"\${w}"\`).join(' OR ');` allows FTS operators inside quotes. Query string not parameterized.
- **Fix:** Escape FTS special characters or validate input strictly: `q.replace(/[*:"()]/g, '')` before query construction.

### HIGH: Insufficient Token Validation in Reset Password
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/reset-password.astro:6`
- **Issue:** Reset token passed directly from URL param to store API without format validation. Allows attacker to probe token space.
- **Fix:** Validate token format before redirecting (UUID pattern or known prefix).

### MEDIUM: CSRF Token Reuse Window Too Long
- **File:** `/Users/charlieseay/Projects/stdout/src/middleware.ts:289`
- **Issue:** CSRF token maxAge is 2 hours, allowing token reuse across many requests if leaked. Should be 15-30 minutes.
- **Fix:** Change `maxAge: 60 * 60 * 2,` to `maxAge: 15 * 60,`.

### MEDIUM: LIKE Wildcard DoS in Stack Search
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/search.ts:94-100`
- **Issue:** Unescaped `%` and `_` wildcards in LIKE queries can cause performance issues with patterns like `%_%`.
- **Fix:** Escape wildcards: `q.replace(/[%_]/g, '\\$&')`.

### MEDIUM: Database Error Details Leaked in Logs
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/search.ts:45, 67, 90, 110, 131`
- **Issue:** catch blocks log full exceptions to console.error, potentially exposing schema details if logs are readable.
- **Fix:** Log only error ID: `console.error(\`[${nanoid()}] FTS error\`)` without full exception.

### MEDIUM: Weak Bearer Token Format Validation
- **File:** `/Users/charlieseay/Projects/stdout/src/middleware.ts:20`
- **Issue:** Bearer token checked only for prefix, not format. Malformed tokens reach hash lookup.
- **Fix:** Validate format: `if (!rawToken.match(/^stdout_scan_[a-zA-Z0-9_-]{40,}$/)) return null;`.

### LOW: Hardcoded Docker Secret Path Exposed in Error
- **File:** `/Users/charlieseay/Projects/stdout/src/lib/sanitize.ts:5`, `/Users/charlieseay/Projects/stdout/src/lib/diagnose.ts:5`
- **Issue:** Error message exposes `/run/secrets/anthropic_api_key` path.
- **Fix:** Generic error message without path disclosure.

### LOW: Email Masking Insufficient in Audit Logs
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/account.ts:30`
- **Issue:** Regex mask `(.{2}).*(@.*)` reveals first 2 characters. Should hash instead.
- **Fix:** Use full hash: `crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)`.

## Efficiency Findings

### HIGH: N+1 Query Pattern in Diagnose
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/diagnose.ts:119-127`
- **Issue:** Fetches all data sources then filters enabled in-memory. Should filter in SQL.
- **Fix:** Add `.where(eq(tenantSchema.dataSources.enabled, true))` to query.

### HIGH: Synchronous FTS Indexing in Critical Path
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/incidents/index.ts:116-123`
- **Issue:** FTS indexing blocks incident creation response. Write lock contention under load.
- **Fix:** Queue FTS async: `Promise.resolve().then(() => { rawDb.prepare(...).run(id); })`.

### MEDIUM: Full-Table Load in Incident Listing
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/incidents/index.ts:51-65`
- **Issue:** Loads all incidents into memory, then filters in JS. No pagination support.
- **Fix:** Use Drizzle `.where()` for filters and `.offset()/.limit()` for pagination.

### MEDIUM: Missing Indexes on user_id Columns
- **File:** `/Users/charlieseay/Projects/stdout/src/lib/db/index.ts:277-545`
- **Issue:** Tenant tables lack indexes on user_id, causing full table scans on large datasets.
- **Fix:** Add in runTenantDDL():
  ```sql
  CREATE INDEX IF NOT EXISTS idx_incidents_user ON incidents(user_id);
  CREATE INDEX IF NOT EXISTS idx_resolutions_user ON resolutions(user_id);
  CREATE INDEX IF NOT EXISTS idx_stacks_user ON stacks(user_id);
  CREATE INDEX IF NOT EXISTS idx_docs_user ON docs(user_id);
  ```

### LOW: Non-Thread-Safe Pool Eviction
- **File:** `/Users/charlieseay/Projects/stdout/src/lib/db/index.ts:590-616`
- **Issue:** LRU eviction not protected by locks. Race conditions under concurrent access.
- **Fix:** Snapshot and sort before evicting: `[...tenantPool.entries()].sort(...)[0]`.

### LOW: Workspace Context Checks Inconsistent
- **File:** `/Users/charlieseay/Projects/stdout/src/pages/app/api/diagnose.ts:77-78`
- **Issue:** Incident lookup uses `locals.user.id` instead of workspace owner ID, inconsistent with DB retrieval.
- **Fix:** Use `const userId = locals.workspace?.ownerId || locals.user.id;` for all lookups.

## Additional Observations

**Authorization Model Inconsistency:** The app mixes workspace-based (`.ownerId`) and user-based (`.id`) authorization, causing the CRITICAL bug. All tenant queries should resolve owner ID first, then verify permission via RBAC.

**Rate Limiting Gap:** Bearer-token endpoints bypass IP-based rate limiting. Leaked token could flood the system. Add per-token rate limiting.

**Content-Type Validation:** Stack import endpoint doesn't validate Content-Type header.

## Summary

Solid foundational security (Argon2, CSRF, prepared queries). Three critical issues need immediate attention:
1. Workspace authorization bypass in incidents
2. Stack ownership validation missing in webhooks
3. FTS query injection from unsanitized input

Efficiency issues moderate but impactful at scale: N+1 queries, full-table loads, missing indexes.

**Immediate:** Fix auth checks in incidents/webhooks, FTS sanitization.
**Short-term:** Add indexes, refactor pagination, defer FTS indexing.
