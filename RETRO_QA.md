# Retro QA — StdOut (`~/Projects/stdout`)

**Workspace:** Astro SSR app (`src/pages/`, `src/lib/`, `src/middleware.ts`).  
**Last updated:** 2026-05-12  
**Note:** QA owns git commits; this document tracks findings and verification only.

---

## 1. Executive summary

- **Windlass Phase 4 (StdOut side):** Persistence, sync, UI, digest plumbing, and timeline integration are implemented in this repository (see section 3). The Windlass **engine** is a separate project ([seayniclabs/windlass](https://github.com/seayniclabs/windlass)); host-side behavior such as “stop on-demand services when free RAM &lt; 1 GB” must be verified in that deployment and reflected in `status.json` / `recent_events`.
- **Security (this pass):** Prior CRITICAL/HIGH items for Auto-Fix UI (`innerHTML` with model-controlled strings) and `autofix-exec` (weak substring blocklist + `execSync`) were **remediated** in code (section 2). Re-run penetration-style checks after each Auto-Fix change.

---

## 2. Security audit — Auto-Fix & incident UI

### 2.1 CRITICAL — Stored/reflected XSS in Auto-Fix plan rendering (`src/pages/app/incidents/[id].astro`)

**Risk:** AI-generated `plan.summary`, `plan.steps[*].description`, commands, files, verification text, stdout/stderr, and `plan.raw` were concatenated into `innerHTML`, allowing script injection if model output or command output contained HTML.

**Status:** **Remediated (2026-05-12).** Dynamic strings are passed through existing `esc()` for HTML contexts; command output uses `textContent` on a `<pre>`; raw plans use `textContent` instead of `innerHTML`.

**Verification:** Generate a plan whose description contains `&lt;img src=x onerror=alert(1)&gt;` — it must render as literal text, not execute.

### 2.2 CRITICAL — Command safety policy bypass (`src/pages/app/api/incidents/autofix-exec.ts`)

**Risk:** `includes()` checks on a contiguous substring missed token-splitting (e.g. `rm` … `-rf` … `/`) and did not block shell chaining (`;`, `|`, `` ` ``, `$()`, newlines).

**Status:** **Remediated (2026-05-12).** Central `assertAutofixCommandAllowed()` rejects control characters and shell metacharacters (e.g. `;`, `|`, `$`, backtick) and applies regex-based destructive patterns before any exec path (local or forwarded to Windlass `/exec`).

**Verification:** POST approved commands that should fail: `rm -r -f /`, `echo;rm -rf /`, `` `rm -rf /` ``, `$(rm -rf /)` — expect `403` with policy message.

### 2.3 HIGH — Event-loop blocking (`execSync`)

**Risk:** `execSync` blocked the Node event loop for up to 30s per request.

**Status:** **Remediated (2026-05-12).** Local fallback uses `promisify(exec)` (`execAsync`) with the same timeout/maxBuffer limits.

---

## 3. Windlass Phase 4 — StdOut implementation map

| Spec | Requirement | StdOut implementation |
|------|-------------|-------------------------|
| **4.1** | Memory pressure shedding; record reason; show on service detail | `tenant-schema.ts`: `windlass_services.last_memory_shed_reason` (+ migration in `src/lib/db/index.ts`). `src/lib/windlass.ts`: reads `last_memory_shed_reason` from engine `status.json` services; upserts into DB; processes `recent_events` with `action === 'memory_shed'` to set reason. UI: `src/pages/app/tools/windlass/services/[id].astro` (last shed reason + memory shed event table). **Engine:** must emit shedding + free RAM logic (not in this repo). |
| **4.2** | n8n schedules in timeline | `windlass.ts` stores `n8n_workflow_windows` from `status.json` into `windlass_config.n8n_workflow_windows_json`. `timeline.astro` renders purple workflow bars. Fallback: `getN8nWorkflowWindows` + `GET /app/api/windlass/n8n-schedules.ts`. |
| **4.3** | Usage analytics + heatmap | `windlass.ts` ingests `service_analytics`, computes `utilization_pct`, `idle_hours_per_day`, persists `usage_analytics` JSON. `services/[id].astro` — “Utilization Heatmap” card (24h cells; keys `00`–`23` or numeric hour). |
| **4.4** | Weekly digest; GB-hours recovered | `computeRecoveredGbHours` in `weekly-digest.ts` and `maybeSendWeeklyDigest` in `windlass.ts`: `(memoryMb/1024) * (idle_minutes_total/60)`. Sunday + 6-day cooldown + `sendWindlassWeeklyDigest`. **Cron:** `GET /app/api/windlass/weekly-digest?secret=…&force=1` or `POST` with `X-Windlass-Digest-Secret` (self-host, no session: iterates users with Windlass enabled). Set `WINDLASS_WEEKLY_DIGEST_SECRET`. |
| **4.5** | Idle &gt; ~18h/day → “suggest scheduling?” | `windlass.ts` sets `scheduling_suggestion` when `idleHoursPerDay >= 18`. Shown on `services/[id].astro`. |

### 3.1 Suggested verification commands (operator)

1. Configure Windlass endpoint; run sync — confirm `windlass_services` rows update and `usage_analytics` populated when engine sends `service_analytics`.
2. Open `/app/tools/windlass/timeline` — n8n rows appear when engine sends `n8n_workflow_windows` or `N8N_API_KEY` live fetch applies.
3. Open a service detail — heatmap, shed reason (after a shed event), scheduling banner when idle threshold met.
4. **Digest:** `curl -sS 'https://<host>/app/api/windlass/weekly-digest?secret=$WINDLASS_WEEKLY_DIGEST_SECRET&force=1'` on self-host, or authenticated `POST` with JSON `{"force":true}`.
5. **Engine RAM &lt; 1 GB shedding:** validate on Windlass host against live `status.json` (not asserted in this repo’s CI).

---

## 4. Prior “wrong workspace” RETRO note (archived context)

An earlier RETRO revision documented a **brief/workspace mismatch** (SvelteKit `bridge` paths vs Astro `stdout`). That explained a failed *retro* dispatch; it did **not** negate Windlass Phase 4 work in this repo. This file is scoped to **StdOut** only.

---

## 5. Open items / limits

- **Multi-tenant SaaS:** Unauthenticated digest with shared secret is **disabled** (`STDOUT_MODE === 'saas'` requires a logged-in `POST`). Self-host cron uses the combined DB user list.
- **Windlass engine version:** Phase 4.1 shedding semantics depend on the deployed engine build; confirm against your `status.json` schema and [Windlass](https://github.com/seayniclabs/windlass) release notes.
