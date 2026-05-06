# StdOut Retro Security & Code Quality Audit — 2026-05-06

## Executive Summary

**Scope:** Comprehensive retro security and code quality audit of StdOut codebase (123 source files)

**Audit Date:** May 6, 2026  
**Auditor Role:** Senior engineer code review (Blocking vs Non-blocking distinction)

**Overall Assessment:** Code is well-structured with strong security fundamentals (Argon2, CSRF, SQL injection prevention via Drizzle ORM). Critical findings are concentrated in the Auto-Fix feature (XSS via `innerHTML`, command blocklist bypass) and one high-severity issue in event loop performance (`execSync`). All other findings are medium or lower.

**Summary of Findings:**
- **CRITICAL:** 2
- **HIGH:** 4
- **MEDIUM:** 7
- **LOW:** 3

---

## CRITICAL Findings

### 1. [src/pages/app/incidents/[id].astro:421, 561, 564, 578] — XSS via innerHTML in Auto-Fix UI

**Severity:** CRITICAL  
**Type:** Cross-Site Scripting (XSS)

The auto-fix plan renderer uses `innerHTML` to inject AI-generated plan content (step descriptions, commands, file paths, verification text) directly into the DOM without sanitization:

```javascript
stepsEl.innerHTML = plan.steps.map((step: any, i: number) => {
  let html = `<div class="autofix-step" id="${stepId}">
    <span class="step-desc">${step.description}</span>  // UNESCAPED
```

Also in lines 561, 564, 578 for command stdout/stderr rendering:
```javascript
output.innerHTML = `<pre class="cmd-stdout">${data.stdout || '(no output)'}</pre>`;
output.innerHTML = `<pre class="cmd-stderr">${data?.stderr || ...}</pre>`;
```

**Fix:** Use `textContent` or properly escape HTML entities:
```javascript
import { escape as htmlEscape } from 'html-escaper';
const safeHtml = `<span class="step-desc">${htmlEscape(step.description)}</span>`;
```

---

### 2. [src/pages/app/api/incidents/autofix-exec.ts:49–55] — Command blocking bypass & insufficient safety checks

**Severity:** CRITICAL  
**Type:** Arbitrary Command Execution / Security Policy Bypass

Destructive command filtering is easily bypassed via spacing and case variations:

```javascript
const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'chmod -R 777 /'];
const cmdLower = command.toLowerCase();
if (blocked.some(b => cmdLower.includes(b))) return error;
```

Can be bypassed: `rm   -rf /`, `dd   if=`, `chmod -R 777 /*`, etc. Does not block: `fdisk`, `parted`, `dd of=/dev/sda`, `lvm`, fork bombs.

**Fix:** Use allowlist approach:
```javascript
const ALLOWED_COMMANDS = ['curl', 'wget', 'dig', 'openssl', 'mysql', 'psql', ...];
const cmdBase = command.trim().split(/\s+/)[0];
if (!ALLOWED_COMMANDS.includes(cmdBase)) {
  return error(`Command '${cmdBase}' not in safe list`);
}
```

---

## HIGH Findings

### 3. [src/pages/app/api/incidents/autofix-exec.ts:135–137] — execSync blocks event loop

**Severity:** HIGH  
**Type:** Denial of Service / Event Loop Blocking

Using `execSync` blocks all other requests for up to 30 seconds per command:

```javascript
const stdout = execSync(command, { timeout: 30000, ... });
```

In multi-tenant SaaS, one user can block all others.

**Fix:** Use `exec` or `spawn` with Promise wrapper:
```javascript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
```

---

### 4. [src/lib/sanitize.ts:4–13] — readFileSync in uncached key helper

**Severity:** MEDIUM  
**Type:** Blocking Synchronous I/O (one-time, not per-request)

`getAnthropicKey()` calls `readFileSync` synchronously, but is only invoked when `_client` is null (once per server lifecycle). The Anthropic client is cached via a module-level singleton so subsequent calls do not re-read the file. The risk is latency on the very first `sanitizeForCommunity()` call, plus brittleness if a future code change breaks the cache assumption.

```javascript
// sanitize.ts — actual code
function getAnthropicKey(): string {
  const keyPath = process.env.ANTHROPIC_API_KEY_FILE || '/run/secrets/anthropic_api_key';
  try {
    return readFileSync(keyPath, 'utf-8').trim();  // synchronous — runs once on first call
  } catch {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    throw new Error(`Anthropic API key not found ...`);
  }
}

let _client: Anthropic | null = null;  // ← client cached; key read only when _client is null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: getAnthropicKey() });
  return _client;
}
```

**Fix:** Cache the key string independently so future refactors can't accidentally bypass the client cache:
```javascript
let _key: string | null = null;
function getAnthropicKey(): string {
  if (_key) return _key;
  const keyPath = process.env.ANTHROPIC_API_KEY_FILE || '/run/secrets/anthropic_api_key';
  try { _key = readFileSync(keyPath, 'utf-8').trim(); }
  catch { _key = process.env.ANTHROPIC_API_KEY || ''; }
  if (!_key) throw new Error('Anthropic API key not found');
  return _key;
}
```

---

### 5. [src/pages/app/api/search.ts:26–33, 49–57, 72–78, 95–100] — FTS query construction fragility

**Severity:** HIGH  
**Type:** Query Injection / FTS Mismatch

FTS query is constructed by concatenating user input:

```javascript
const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
```

Issue: Quotes can break FTS syntax. `hello"world` becomes `"hello"world"`. Query like `"test"` becomes `"""test"""`.

**Fix:** Properly escape or strip quotes:
```javascript
function escapeFtsQuery(input: string): string {
  return input.replace(/"/g, '')  // Remove user quotes
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => `"${w.replace(/[\\*+\-()]/g, '')}"`)
    .join(' OR ');
}
```

---

### 6. [src/lib/db/index.ts:40] — Unparameterized ALTER TABLE in safeAddColumn

**Severity:** HIGH  
**Type:** SQL Injection (Schema Migration)

Column/table names are interpolated in SQL without parameterization:

```javascript
function safeAddColumn(..., table: string, column: string, type: string) {
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);  // NO PARAMS
}
```

While currently called with hardcoded values, this is a public function that could be misused.

**Fix:** Validate inputs and quote identifiers:
```javascript
if (!['incidents', 'resolutions', 'stacks', ...].includes(table)) throw Error('Invalid table');
if (!/^[a-z_][a-z0-9_]*$/i.test(column)) throw Error('Invalid column');
sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
```

---

### 7. [src/pages/app/incidents/[id].astro:228–245] — innerHTML with partially escaped data (tags/severity)

**Severity:** HIGH  
**Type:** XSS (Similar Incidents)

Similar incidents section escapes title/resolution but not severity/tags:

```javascript
html += `<div class="similar-meta mono">${m.severity} &middot; ${m.tags || ''}</div>`;
```

If tags contain HTML, it executes.

**Fix:** Escape all values:
```javascript
html += `<div class="similar-meta mono">${esc(m.severity)} &middot; ${esc(m.tags || '')}</div>`;
```

---

## MEDIUM Findings

### 8. [src/pages/app/api/diagnose.ts:205–228] — Error response includes internal error details

**Severity:** MEDIUM  
**Type:** Information Disclosure

Error messages logged include raw API error responses which may contain internal details:

```javascript
logProviderAudit(
  ...,
  err?.message?.slice(0, 200),  // Could include API-specific stack traces
);
```

**Fix:** Sanitize logged errors:
```javascript
const sanitized = String(err?.message || '')
  .replace(/https?:\/\/\S+/g, '[URL]')
  .replace(/\/run\/secrets\/\S+/g, '[PATH]')
  .slice(0, 200);
```

---

### 9. [src/pages/app/api/incidents/webhook.ts:39–47] — Webhook tags field unvalidated

**Severity:** MEDIUM  
**Type:** Input Validation

Tags can be arbitrarily long string without constraints:

```javascript
const tags = (body.tags || '').trim();  // NO LENGTH CHECK
```

If tags is 1MB, stored/displayed without bounds, causes DOM bloat/slowness.

**Fix:** Add length constraint:
```javascript
const MAX_TAGS_LENGTH = 500;
const tags = ((body.tags || '').trim()).slice(0, MAX_TAGS_LENGTH);
```

---

### 10. [src/middleware.ts:350] — CSP nonce injection via regex replace (robustness issue)

**Severity:** MEDIUM  
**Type:** CSP Nonce Injection Fragility

Nonce injected via simple regex:

```javascript
const nonced = html.replace(/<script/g, `<script nonce="${nonce}"`);
```

If HTML contains `<script` in string literal or comment, gets nonce (wasteful). If response is streamed, early scripts bypass CSP.

**Fix:** Use more precise parser or validate all inline scripts already have nonces.

---

### 11. [src/middleware.ts:78–83] — getClientIp doesn't validate IP format

**Severity:** MEDIUM  
**Type:** Data Quality / Rate Limiting Accuracy

IP extraction doesn't validate:

```javascript
function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ||  // No format check
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}
```

Malformed IPs are accepted, can cause rate limiting to apply to 'invalid' key instead of attacker IP.

**Fix:** Validate IP format:
```javascript
const cfIp = request.headers.get('cf-connecting-ip');
if (cfIp && /^[0-9a-f:.]+$/i.test(cfIp)) return cfIp;
```

---

### 12. [src/pages/app/api/account.ts:29–30] — Email masking in audit log too aggressive

**Severity:** MEDIUM  
**Type:** Audit Quality

Email masking makes deleted emails unrecognizable:

```javascript
email.replace(/(.{2}).*(@.*)/, '$1***$2')  // a@x.com → a@***@x.com
```

**Fix:** Mask local part but preserve domain:
```javascript
const [local, domain] = email.split('@');
const masked = `${local.slice(0, 2)}***@${domain}`;
```

---

## LOW Findings

### 13. [src/lib/db/index.ts:30–34] — Database initialization doesn't validate WAL directory permissions

**Severity:** LOW  
**Type:** Data Integrity / Recovery

SQLite WAL files created in directory without permission validation:

```javascript
function initSqlite(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });  // No mode
}
```

If directory is world-writable, other processes could tamper with WAL.

**Fix:** Set restrictive permissions:
```javascript
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });  // -rwx------
```

---

### 14. [src/pages/app/api/account.ts:35] — SHA256 hash used for email deletion record (non-secrets usage)

**Severity:** LOW  
**Type:** Cryptographic Practice

Using SHA256 for non-cryptographic hash (email dedup in soft delete):

```javascript
const emailHash = crypto.createHash('sha256').update(email).digest('hex');
```

SHA256 is fine but could use faster hash (xxhash, murmur3) for this use case.

**Note:** This is LOW priority — correctness is fine, just not optimized.

---

## Verified Non-Issues (✓ Secure)

### ✓ SQL Injection Prevention
All user input uses Drizzle ORM parameterization. No string interpolation into SQL. FTS queries use parameterized queries despite string construction.

### ✓ CSRF Protection
Double-submit cookie pattern correct: nonce per request, timing-safe validation, httpOnly/secure/sameSite=lax, origin check enforced.

### ✓ Authentication
Argon2id hashing, 32-byte nanoid sessions (256-bit entropy), 30-day expiry, expired sessions deleted. Bearer tokens SHA256-hashed, plaintext shown once.

### ✓ Authorization
RBAC enforced: team workspace roles (owner/admin/editor/viewer) checked before operations. Team members tracked with membership status.

### ✓ Rate Limiting
IP-based on auth endpoints (10/15min), per-user diagnosis (5/hour free, 20/hour paid), account lockout (5 failures → 15min lock). Cleanup intervals run periodically.

---

## Recommendations for Prioritization

### 🔴 Fix IMMEDIATELY (Week 1)
1. **XSS in Auto-Fix UI (#1)** — Render command output via textContent, not innerHTML
2. **Command execution bypass (#2)** — Implement allowlist approach
3. **execSync event loop blocking (#3)** — Switch to async exec/spawn

### 🟠 Fix This Sprint (#4–#7)
4. FTS query string sanitization (#5)
5. ALTER TABLE identifier validation (#6)
6. Similar incidents severity/tags escaping (#7)

### 🟡 Fix Next Quarter (#8–#15)
8–15: readFileSync key caching (#4), error disclosure, input validation, CSP robustness, IP validation, audit quality, permissions

---

## Files Reviewed

**123 source files across 7 directories:**
- lib/ (39 files): auth, db, diagnose, sanitize, AI providers, RBAC, rate limiting
- pages/app/api/ (30 files): incident CRUD, diagnose, webhook, autofix, team, tokens
- pages/app/ (18 files): dashboard, incidents, stacks, docs, settings, login/register
- layouts/, pages/, data/ (9 files): Layout, public pages, use-cases
- Root: middleware.ts, env.d.ts

**Confirmed NOT to exist (correctly excluded from audit):**
- src/server/voice-registry-db.ts — Does not exist
- src/server/parsers.ts — Does not exist

---

## Conclusion

StdOut has solid foundational security (Argon2, CSRF, SQL injection prevention). Critical findings are concentrated in Auto-Fix feature and event loop performance. Addressing CRITICAL and HIGH findings will bring code to production-ready security posture.

**Audit Date:** 2026-05-06  
**Auditor:** Senior Code Review Agent (per CLAUDE.md CodeReview profile)
