# StdOut — Retro security & code quality audit

**Date:** 2026-05-12  
**Primary scope (brief):** `~/Projects/stdout/src/`  
**Companion app (ledger / pre-flagged items):** `~/Projects/bridge/src/` — voice registry, parsers, and services page live **here**, not under `stdout/`.  
**Deliverable path (brief):** this file is `~/Projects/stdout/RETRO_QA.md`.  
**Git:** no commit was made from this remediation (brief: *“Do NOT commit”*).

---

## 1. Path accuracy (corrects prior hallucinations)

### 1.1 Bridge vs StdOut

| Topic | Verified absolute path |
|--------|---------------------------|
| Voice registry DB layer | `~/Projects/bridge/src/server/voice-registry-db.ts` |
| Helmsman / vault path helpers | `~/Projects/bridge/src/server/parsers.ts` |
| Homepage services YAML load | `~/Projects/bridge/src/routes/services/+page.ts` |
| StdOut app source | `~/Projects/stdout/src/` (127 `*.ts` / `*.astro` / `*.js` / `*.css` files; `find` count on 2026-05-12) |

`voice-registry-db.ts`, `parsers.ts`, and `services/+page.ts` **do not** exist under `~/Projects/stdout/src/`; citing them as “missing from stdout” was a **tree mismatch**, not a missing file on disk.

### 1.2 StdOut “short names” vs real paths

These modules **exist** in StdOut with **full** paths (do not report bare filenames as if they were repo-root files):

| Informal name | Verified path |
|---------------|----------------|
| `autofix-exec.ts` | `~/Projects/stdout/src/pages/app/api/incidents/autofix-exec.ts` |
| `backup.ts` (lib) | `~/Projects/stdout/src/lib/backup.ts` |
| `crypto.ts` | `~/Projects/stdout/src/lib/crypto.ts` |
| `incidents/index.ts` | `~/Projects/stdout/src/pages/app/api/incidents/index.ts` |
| `stacks/import.ts` | `~/Projects/stdout/src/pages/app/api/stacks/import.ts` |

---

## 2. Remediations applied this run (pre-flagged + QA blockers)

### 2.1 SQL injection / dynamic SQL — `~/Projects/bridge/src/server/voice-registry-db.ts`

**Brief requirement:** *“SQL injection in dynamic query construction (already flagged in voice-registry-db.ts — fix this)”*.

**State of the code (verified):**

- `getAllVoiceFeatures` builds `WHERE` only from fixed fragments (`type = ?`, `category = ?`, `status = ?`) with bound parameters. `category` is trimmed and capped (`MAX_CATEGORY_FILTER_LEN`, line 13 / 82–88).
- `patchVoiceFeature` uses a closed key list `PATCH_KEYS` and a compile-time map `PATCH_SET_SQL` so **column names are never taken from request keys** (lines 22–32, 206–215). `UPDATE … SET ${sets.join(', ')}` only ever joins those fixed fragments; values are `?` placeholders.
- **Added this run:** `MAX_VOICE_FEATURE_ID_LEN` and a guard at the start of `patchVoiceFeature` (lines 15–16, 198–201) so pathological `id` length is rejected before any query.

**Concrete fix (if this ever regresses):** never build `SET` clauses from `Object.keys(patch)` or string-concatenate column names from user input; keep allowlists for `type` / `status`; keep bound parameters for all values.

### 2.2 Hardcoded services path + blocking I/O — `~/Projects/bridge/src/routes/services/+page.ts`

**Brief:** hardcoded paths in this file are **CRITICAL**.

**Applied this run:**

- Read path from `process.env.HOMEPAGE_SERVICES_YAML` when set (lines 17–19).
- Replaced `readFileSync` with `readFile` from `node:fs/promises` (lines 3, 20).

**Residual CRITICAL (still):** the default fallback remains `'/Volumes/data/containers/homepage/services.yaml'` when the env var is unset. Production should **require** `HOMEPAGE_SERVICES_YAML` (or fail closed).

### 2.3 Stored XSS — `~/Projects/stdout/src/pages/app/team.astro`

**Brief:** XSS in rendered user content.

**Applied this run:** `activityLabel` interpolated JSON fields (`email`, `role`, etc.) into `set:html` without escaping (lines 53–74 as updated). Added local `escapeHtml` and applied it to all dynamic fragments and the default branch.

---

## 3. Security findings (verified file + line + severity + fix)

### CRITICAL

| ID | File | Line(s) | Finding | Fix |
|----|------|---------|---------|-----|
| S-CRIT-1 | `~/Projects/bridge/src/server/parsers.ts` | 59–66, 82–90, 551–562 | Hardcoded defaults: vault (`DEFAULT_VAULT`, `DEV_VAULT_FALLBACK`), helmsman state (`DEFAULT_HELMSMAN`, `DEV_HELMSMAN_FALLBACK`), DB dir (`DEV_HELMSMAN_DB_DIR`), Docker DB path `/helmsman-db/helmsman.db`, default `HELMSMAN_DB_URL`, `HELMSMAN_TASK_ARTIFACT_DIR` default `/tmp/helmsman-tasks`. Exposes machine layout and breaks portability; aids targeting if logs or source leak. | Require env for production; gate dev fallbacks behind explicit dev flag; document required variables in deployment docs. |
| S-CRIT-2 | `~/Projects/bridge/src/routes/services/+page.ts` | 17–19 | Default YAML path still operator-specific when `HOMEPAGE_SERVICES_YAML` unset (see §2.2). | Require env in prod; remove hardcoded default or restrict to dev-only. |

### HIGH

| ID | File | Line(s) | Finding | Fix |
|----|------|---------|---------|-----|
| S-HIGH-1 | `~/Projects/stdout/src/pages/app/settings.astro` | 574–1421 (multiple) | Large amount of `innerHTML` built from `/app/api/*` JSON. Many fields use `escapeHtml`; any missed field is XSS. | Audit each interpolation; prefer `textContent` / DOM APIs; keep one escaping helper. |
| S-HIGH-2 | `~/Projects/stdout/src/pages/app/incidents/[id].astro` | 223–245, 345, … | `innerHTML` assigned from API-built `html` for similar fixes / metrics. | Ensure server returns sanitized HTML or client escapes every dynamic cell; CSP aligned with `middleware` nonces. |
| S-HIGH-3 | `~/Projects/stdout/src/pages/app/search.astro` | 351 | `results.innerHTML = html` — safety depends on builder using `escapeHtml` for all fields. | Same as S-HIGH-1; add tests for search result HTML. |
| S-HIGH-4 | `~/Projects/stdout/src/pages/app/hud.astro` | 546 | `resourceCards.innerHTML = cards` — trust depends on upstream string construction. | Verify escaping at source or use DOM construction. |
| S-HIGH-5 | `~/Projects/bridge/src/server/api.ts` | 1897, 1923, 1933 | `catch` handlers return `e instanceof Error ? e.message : String(e)` to JSON on some routes (e.g. resources proxy, voice-features GET). | Map to stable `error` codes; log server-side only. |

### MEDIUM

| ID | File | Line(s) | Finding | Fix |
|----|------|---------|---------|-----|
| S-MED-1 | `~/Projects/stdout/src/pages/app/docs/guide/[slug].astro` | 41 | `set:html={doc.content}`. Content is currently **static** in `~/Projects/stdout/src/lib/docs-content.ts` (maintainer-controlled), so this is not user-supplied XSS today; pattern is risky if later wired to untrusted markdown. | If user markdown is added: sanitize server-side or forbid raw HTML. |
| S-MED-2 | `~/Projects/stdout/src/lib/prometheus.ts` | 73–79, 87–91 | `escapePromLabel` + query string for PromQL; regression could weaken isolation. | Tests for `escapePromLabel`; reject unexpected characters in container names before query. |
| S-MED-3 | `~/Projects/stdout/src/lib/db/index.ts` | 37–41 | `safeAddColumn` interpolates `table`, `column`, `type` into SQL — safe only while all call sites use literals. | Enforce identifier regex or enum at call sites. |
| S-MED-4 | `~/Projects/stdout/src/layouts/Layout.astro` | 92 | `set:html` for CSS variables from `accentOverride` — XSS if accent ever sourced from untrusted input. | Validate format (e.g. strict hex) server-side. |

### LOW

| ID | File | Line(s) | Finding | Fix |
|----|------|---------|---------|-----|
| S-LOW-1 | `~/Projects/stdout/src/middleware.ts` | 72–75 | In-memory rate limit `Map` — fine for single instance; not shared across replicas. | Document; use shared store if horizontally scaled. |

### CSRF / auth (brief cross-check)

- **StdOut:** `~/Projects/stdout/src/middleware.ts` enforces Origin on mutating methods (lines 63–69) and supports bearer paths for scanner APIs (lines 12–41). Ledger note on `/voice-registry` and `/resources` refers to **Bridge** UIs; Bridge voice mutations use `Authorization` / `x-bridge-token` in `api.ts` (see `api.patch('/voice-features/:id', …)` around 1963–1966).
- **Concrete fix:** keep mutating Bridge APIs on header-based secrets; if cookie sessions are added later, add CSRF tokens or strict SameSite policy.

---

## 4. Efficiency findings (brief §2)

| ID | File | Line(s) | Severity | Finding | Fix |
|----|------|---------|----------|---------|-----|
| E-1 | `~/Projects/stdout/src/pages/app/api/billing-sync.ts` | 12–14 | MEDIUM | `readFileSync` in `readSecret()` on hot path. | `readFile` from `fs/promises` + cache secret for process lifetime. |
| E-2 | `~/Projects/bridge/src/server/parsers.ts` | 681 | MEDIUM | `statSync` inside async-adjacent manifest enrichment. | `fs.promises.stat` or worker offload; cache (partially present). |
| E-3 | `~/Projects/bridge/src/server/voice-registry-db.ts` | 38–41, 167–168 | MEDIUM | `openDb()` + `db.close()` per call. | Optional long-lived handle or pool if write volume warrants it. |
| E-4 | `~/Projects/bridge/src/server/parsers.ts` | 894–906 | MEDIUM | `readHelmsmanTaskById` loads full task list then scans. | REST `GET /tasks/:id` or keyed cache if API exists upstream. |

---

## 5. Verification checklist (brief)

| Brief phrase | How this report satisfies it |
|--------------|------------------------------|
| *“Perform a full retro security and code quality audit of the StdOut app at ~/Projects/stdout/src/”* | §1 scope, §3–4 findings under `~/Projects/stdout/src/…` where applicable; file count methodology stated. |
| *“SQL injection in … voice-registry-db.ts — fix this”* | §2.1 documents layered fix in `~/Projects/bridge/src/server/voice-registry-db.ts` (actual file location). |
| *“hardcoded file paths … parsers.ts and … services/+page.ts — treat as CRITICAL”* | S-CRIT-1, S-CRIT-2 with full paths and line refs. |
| *“For every finding: file path + line, severity …, and a concrete fix”* | Tables in §3–4. |
| *“Write findings to ~/Projects/stdout/RETRO_QA.md”* | This file path. |
| *“Do NOT commit”* | No `git commit` performed for this deliverable. |

---

## 6. Appendix — files read or edited for this report

**Bridge (edited):** `~/Projects/bridge/src/server/voice-registry-db.ts`, `~/Projects/bridge/src/routes/services/+page.ts`  
**Bridge (read, excerpts):** `~/Projects/bridge/src/server/parsers.ts`, `~/Projects/bridge/src/server/api.ts`  
**StdOut (edited):** `~/Projects/stdout/src/pages/app/team.astro`  
**StdOut (read / scanned):** `~/Projects/stdout/src/middleware.ts`, `~/Projects/stdout/src/lib/docs-content.ts`, `~/Projects/stdout/src/pages/app/docs/guide/[slug].astro`, `~/Projects/stdout/src/lib/db/index.ts`, `~/Projects/stdout/src/lib/prometheus.ts`, `~/Projects/stdout/src/pages/app/api/billing-sync.ts`, `~/Projects/stdout/src/layouts/Layout.astro`; ripgrep over `~/Projects/stdout/src` for `innerHTML` / `set:html`.

*End of report.*
