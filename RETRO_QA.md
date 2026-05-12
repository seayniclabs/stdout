# Retro QA — StdOut (`~/Projects/stdout`)

**Workspace:** Astro SSR app (`src/pages/`, `src/lib/`, `src/middleware.ts`).  
**Last updated:** 2026-05-12  
**Note:** QA owns git commits; this document tracks findings, remediation, Phase 4 traceability, and operator verification only.

---

## Table of contents

1. [Executive summary](#1-executive-summary)  
2. [Repository scope (StdOut vs engine vs scanner)](#2-repository-scope-stdout-vs-engine-vs-scanner)  
3. [Windlass Phase 4 — specification to implementation](#3-windlass-phase-4--specification-to-implementation)  
4. [Security audit — Auto-Fix and incident UI](#4-security-audit--auto-fix-and-incident-ui)  
5. [Appendix A — File manifest (Phase 4 + security)](#5-appendix-a--file-manifest-phase-4--security)  
6. [Appendix B — Operator verification checklist](#6-appendix-b--operator-verification-checklist)  
7. [Appendix C — Windlass engine (out-of-repo) reference](#7-appendix-c--windlass-engine-out-of-repo-reference)  
8. [Appendix D — Archived: brief / workspace mismatch incident](#8-appendix-d--archived-brief--workspace-mismatch-incident)  
9. [Appendix E — Residual risks and limits](#9-appendix-e--residual-risks-and-limits)

---

## 1. Executive summary

- **Windlass Phase 4:** StdOut implements persistence, sync ingestion, service detail UI (memory shed reason, utilization heatmap, scheduling suggestion), timeline n8n rows, weekly digest HTTP triggers, and weekly digest side-effects on successful Windlass sync (Sunday UTC gate + cooldown). Host-side shedding, analytics sampling, and `status.json` emission are implemented in the **Windlass** Python engine (see Appendix C), not in this repository.
- **Security (this pass):** Prior CRITICAL findings (Auto-Fix plan HTML injection via unsanitized model strings; weak substring command blocklist; `execSync` blocking) are **remediated in code** with defense-in-depth (`esc` for HTML attribute/text contexts including `&` and `'`; `assertAutofixCommandAllowed`; `promisify(exec)`). Re-run manual verification after any Auto-Fix or exec-path change.
- **Documentation integrity:** This file supersedes earlier “HALTED / wrong workspace” stubs that discarded structured audit content. The archived context is preserved in [§8](#8-appendix-d--archived-brief--workspace-mismatch-incident) without conflating it with Phase 4 delivery.

---

## 2. Repository scope (StdOut vs engine vs scanner)

| Path / repo | Role |
|-------------|------|
| **`~/Projects/stdout`** (this repo) | Astro app: Windlass sync client, tenant SQLite schema, Windlass UI, weekly digest API, Auto-Fix UI and exec API. |
| **`~/Projects/windlass`** (Python engine, sibling checkout) | Host agent: `schedule.yaml`, Docker compose control, `status.json`, memory-pressure shedding, hourly `service_analytics`, n8n workflow windows merge, `recent_events`. |
| **`~/Projects/stdout-scanner`** | Separate Go-based network scanner; **not** the Windlass scheduler. Do not use it as the Phase 4 engine reference. |

Authoritative public engine source: [github.com/seayniclabs/windlass](https://github.com/seayniclabs/windlass).

---

## 3. Windlass Phase 4 — specification to implementation

### 3.1 Traceability matrix

| Spec | Requirement | StdOut | Engine (Windlass) |
|------|-------------|--------|-------------------|
| **4.1** | When host free RAM < 1 GB, stop lowest-priority **on-demand** services; record reason; show on service detail | Column `windlass_services.last_memory_shed_reason` (`src/lib/db/tenant-schema.ts`); migration `safeAddColumn` in `src/lib/db/index.ts`. `syncFromEndpoint` reads `last_memory_shed_reason` from each service in `status.json` and upserts; processes `recent_events` where `action === 'memory_shed'` to persist reason (`src/lib/windlass.ts`). UI: `src/pages/app/tools/windlass/services/[id].astro` (Resources card + memory shed event table). | `MEMORY_SHED_FREE_MB_THRESHOLD` (default 1024), candidate sort by priority + memory, `docker_compose_down`, `last_memory_shed_reason` on service state, `log_event(..., "memory_shed", reason)` — see `windlass.py` (Appendix C). |
| **4.2** | n8n workflow schedules in timeline | `n8n_workflow_windows` from `status.json` stored as `windlass_config.n8n_workflow_windows_json` on sync (`src/lib/windlass.ts`). `getN8nWorkflowWindowsForDisplay` prefers cache, else `N8N_API_KEY` live fetch (`getN8nWorkflowWindows`). Timeline: `src/pages/app/tools/windlass/timeline.astro` (purple `tl-workflow` blocks). JSON API: `src/pages/app/api/windlass/n8n-schedules.ts`. | `_n8n_windows_from_file`, `_n8n_windows_from_api`, `get_n8n_workflow_windows`, included in `status.json` payload. |
| **4.3** | Usage analytics + utilization heatmap | Engine sends `service_analytics`; `syncFromEndpoint` computes `utilization_pct`, `idle_hours_per_day`, persists `usage_analytics` JSON (`src/lib/windlass.ts`). Service detail: “Utilization Heatmap” card, 24 hourly cells keyed `00`–`23` with numeric fallbacks (`src/pages/app/tools/windlass/services/[id].astro`). | Scheduler loop updates `state["analytics"]` per service with hourly buckets and `idle_minutes_total` / `samples`. |
| **4.4** | Weekly summary (Telegram/email); GB-hours recovered | `computeRecoveredGbHours` in `src/pages/app/api/windlass/weekly-digest.ts` and duplicate logic in `maybeSendWeeklyDigest` (`src/lib/windlass.ts`): `(memoryMb/1024) * (idle_minutes_total/60)` summed across services. Dispatch: `sendWindlassWeeklyDigest` in `src/lib/alert-router.ts`. **Triggers:** (a) Authenticated `POST`/`GET` weekly-digest route; (b) self-host `GET`/`POST` with `WINDLASS_WEEKLY_DIGEST_SECRET`; (c) `maybeSendWeeklyDigest` after sync on **Sunday UTC** with 6-day cooldown (supplements cron). | Analytics source in `state.json` maintained by engine scheduler. |
| **4.5** | Idle > ~18 h/day → “suggest scheduling?” | `scheduling_suggestion` set in `syncFromEndpoint` when `idleHoursPerDay >= 18` (`src/lib/windlass.ts`). Banner on service detail (`services/[id].astro`). | Supplies `idle_minutes_total` and hourly samples so StdOut can derive idle hours/day using `summary.scheduler_interval_sec`. |

### 3.2 Schema and migrations (StdOut)

Windlass-related columns on `windlass_services` / `windlass_config` include: `usage_analytics`, `utilization_pct`, `idle_hours_per_day`, `scheduling_suggestion`, `last_memory_shed_reason`, `last_weekly_digest_at`, `n8n_workflow_windows_json`. Drizzle definitions live in `src/lib/db/tenant-schema.ts`; additive SQLite migrations in `src/lib/db/index.ts` (`safeAddColumn`).

### 3.3 Event model

`windlass_events.event_type` enum includes `memory_shed`. Sync maps engine `recent_events[].action === 'memory_shed'` to typed rows and updates `last_memory_shed_reason` on the affected service row.

---

## 4. Security audit — Auto-Fix and incident UI

### 4.1 CRITICAL — Stored / reflected XSS in Auto-Fix plan rendering

**Affected surface:** `src/pages/app/incidents/[id].astro` — client-side plan rendering used `innerHTML` with model-controlled fields (`plan.summary`, step descriptions, commands, files, verification, rollback, `plan.raw`).

**Attack scenario:** Model or tool output embeds HTML or attribute-breakout sequences (for example image tags with `onerror`, or `"><script>…`), allowing script execution or attribute breakout when concatenated into `innerHTML`.

**Remediation (current code):**

- User-visible and model-generated strings inserted into HTML templates use `esc()` which escapes ampersand, angle brackets, double quotes, and apostrophes for HTML contexts.
- Command stdout/stderr for executed steps is applied with `textContent` on a `<pre>` node, not `innerHTML`.
- Fallback `plan.raw` is attached as `textContent` on a `<pre>`, not HTML.

**Primary code references:** `esc` definition and plan render block in `src/pages/app/incidents/[id].astro` (client script).

**Verification:** Approve a plan whose description contains a literal HTML probe such as `<img src=x onerror=alert(1)>` — it must display as text with no script execution.

**Residual notes:** `innerHTML` is still used for **static** SVG icon fragments on copy/run buttons (fixed markup, not model output). Progress markup uses numeric `total` only.

---

### 4.2 CRITICAL — Command safety policy bypass (substring blocklist)

**Affected surface:** `src/pages/app/api/incidents/autofix-exec.ts` — earlier patterns relied on naive `includes()` substrings, missing token-split evasions (`rm` … `-rf` … `/`) and shell metacharacters (`;`, `|`, command substitution).

**Attack scenario:** User approves a plan step whose command uses shell chaining or spacing to evade a flat substring denylist, or combines benign tokens that expand destructively when executed under `/bin/sh -c`.

**Remediation (current code):**

- Central `assertAutofixCommandAllowed(command)` rejects NUL/newlines, shell metacharacters (`;`, `|`, `$`, backtick per policy regex), and applies regex-based destructive patterns (e.g. `rm` with recursive force variants) on the **full** command string before any execution path (Windlass `/exec` or local `exec` fallback).

**Primary code references:** `assertAutofixCommandAllowed` in `src/pages/app/api/incidents/autofix-exec.ts`.

**Verification:** `POST` with `approved: true` should return **403** for commands such as: `rm -r -f /`, `echo;rm -rf /`, `` `rm -rf /` ``, `$(rm -rf /)` (exact bodies per your integration tests).

**Residual notes:** StdOut cannot guarantee the Windlass `/exec` endpoint enforces an identical policy; operators should keep engine `EXEC_*` rules aligned. URL `&` in otherwise safe `curl` commands remains allowed by design.

---

### 4.3 HIGH — Event-loop blocking (`execSync`)

**Affected surface:** Local fallback execution path for Auto-Fix previously used synchronous `execSync`, blocking the Node event loop for up to the configured timeout.

**Remediation (current code):** `promisify(exec)` as `execAsync` with `timeout` and `maxBuffer` limits, preserving exit code mapping from thrown errors.

**Primary code references:** `executeCommand` in `src/pages/app/api/incidents/autofix-exec.ts`.

---

## 5. Appendix A — File manifest (Phase 4 + security)

| File | Purpose |
|------|---------|
| `src/lib/db/tenant-schema.ts` | Windlass tables including `lastMemoryShedReason`, `usageAnalytics`, `schedulingSuggestion`, `n8nWorkflowWindowsJson`, `lastWeeklyDigestAt`. |
| `src/lib/db/index.ts` | SQLite `safeAddColumn` migrations for Phase 4 columns. |
| `src/lib/windlass.ts` | `WindlassStatus` types, `syncFromEndpoint` (analytics, n8n snapshot, memory shed events, `maybeSendWeeklyDigest`), n8n helpers, service queries. |
| `src/lib/alert-router.ts` | `sendWindlassWeeklyDigest` (email/Telegram-capable channels). |
| `src/pages/app/tools/windlass/services/[id].astro` | Service detail: shed reason, heatmap, scheduling suggestion, events. |
| `src/pages/app/tools/windlass/timeline.astro` | 24h timeline with n8n workflow rows. |
| `src/pages/app/api/windlass/n8n-schedules.ts` | JSON `workflows` for integrations / HUD. |
| `src/pages/app/api/windlass/weekly-digest.ts` | `computeRecoveredGbHours`, authenticated and secret-based digest triggers. |
| `src/middleware.ts` | Windlass bearer path registration (sync sidecar / events). |
| `src/pages/app/incidents/[id].astro` | Auto-Fix UI; `esc` and safe rendering. |
| `src/pages/app/api/incidents/autofix-exec.ts` | Policy gate + async exec + Windlass `/exec` forward. |

### 5.1 Key line anchors (snapshot: 2026-05-12)

Line numbers drift with edits; use symbols when reconciling diffs.

| Area | File | Notes |
|------|------|--------|
| `WindlassStatus` + `service_analytics` / `n8n_workflow_windows` types | `src/lib/windlass.ts` | Top of file: JSON contract from engine. |
| Analytics → `utilizationPct`, `idleHoursPerDay`, `schedulingSuggestion`, `lastMemoryShedReason` on upsert | `src/lib/windlass.ts` | Inside `syncFromEndpoint` service loop (parses `status.service_analytics`, derives idle hours from `scheduler_interval_sec`). |
| `recent_events` ingest + `memory_shed` → DB + `lastMemoryShedReason` update | `src/lib/windlass.ts` | Loop over `status.recent_events` after service upserts. |
| `n8nWorkflowWindowsJson` snapshot on config row | `src/lib/windlass.ts` | End of `syncFromEndpoint` before `maybeSendWeeklyDigest`. |
| Sunday UTC digest + `recoveredGbHours` sum | `src/lib/windlass.ts` | `maybeSendWeeklyDigest` helper. |
| Drizzle columns | `src/lib/db/tenant-schema.ts` | `windlassServices` / `windlassConfig` definitions. |
| additive SQLite columns | `src/lib/db/index.ts` | `safeAddColumn` for Windlass Phase 4 fields. |
| Heatmap + shed UI + scheduling banner | `src/pages/app/tools/windlass/services/[id].astro` | Resources + Utilization Heatmap sections. |
| n8n rows on timeline | `src/pages/app/tools/windlass/timeline.astro` | `getN8nWorkflowWindowsForDisplay`, `tl-workflow` styling. |
| Digest HTTP API + `computeRecoveredGbHours` | `src/pages/app/api/windlass/weekly-digest.ts` | `POST` / `GET`, secret vs session behavior. |
| `assertAutofixCommandAllowed` + `execAsync` | `src/pages/app/api/incidents/autofix-exec.ts` | Policy + execution. |
| `esc` + plan `innerHTML` assembly | `src/pages/app/incidents/[id].astro` | Client script: Auto-Fix render path. |

### 5.2 Weekly digest — example HTTP calls

**Browser session (cookie):** no shared secret header required when `WINDLASS_WEEKLY_DIGEST_SECRET` is set.

```bash
# Logged-in session from browser devtools: copy cookie, then:
curl -fsS -X POST 'https://your-host/app/api/windlass/weekly-digest' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: sl_session=…' \
  --data '{"force":true}'
```

**Machine cron (self-host, no session):** query secret on `GET`, or header on `POST`.

```bash
curl -fsS -X POST 'http://127.0.0.1:4321/app/api/windlass/weekly-digest' \
  -H 'Content-Type: application/json' \
  -H "X-Windlass-Digest-Secret: $WINDLASS_WEEKLY_DIGEST_SECRET" \
  --data '{"force":false}'
```

---

## 6. Appendix B — Operator verification checklist

1. **4.1 Memory shed:** On a host running Windlass, force free RAM below `WINDLASS_MEMORY_SHED_FREE_MB` (default 1024) with on-demand services configured; confirm engine stops lowest-priority on-demand stacks, emits `memory_shed` in `recent_events`, and sets per-service `last_memory_shed_reason` in `status.json`. Run StdOut Windlass sync; confirm `last_memory_shed_reason` and shed rows on `/app/tools/windlass/services/{id}`.
2. **4.2 n8n windows:** Populate `n8n-workflows.json` or configure `WINDLASS_N8N_BASE_URL` + API key on the engine; confirm `status.json` contains `n8n_workflow_windows`. Sync StdOut; open `/app/tools/windlass/timeline` and confirm purple workflow bars.
3. **4.3 Heatmap:** After several scheduler intervals, confirm `service_analytics` in `status.json` and heatmap cells on service detail change from `heat-none` to `heat-idle` / `heat-running` as appropriate.
4. **4.4 Digest:** Configure email or Telegram alert channels. Call `POST /app/api/windlass/weekly-digest` with session cookie or with `X-Windlass-Digest-Secret` on self-host bulk mode. Alternatively `GET /app/api/windlass/weekly-digest?secret=…&force=1` from cron. Expect non-zero `recoveredGbHours` only when `usage_analytics` includes `idle_minutes_total` and services have `memory_mb`.
5. **4.5 Scheduling prompt:** With analytics implying `idle_hours_per_day >= 18`, confirm `scheduling_suggestion` banner appears on service detail.
6. **Security:** Re-run XSS spot-check (§4.1) and blocked-command matrix (§4.2) on staging.

**Example cron (self-host, weekly Sunday 09:00 Chicago):** adjust host URL and secret.

```bash
0 9 * * 0 curl -fsS 'https://stdout.example.com/app/api/windlass/weekly-digest?secret=$WINDLASS_WEEKLY_DIGEST_SECRET&force=1' -o /tmp/windlass-digest.log
```

---

## 7. Appendix C — Windlass engine (out-of-repo) reference

When reviewing Phase 4 **host behavior**, use the Python tree (local checkout `~/Projects/windlass` or GitHub `seayniclabs/windlass`). High-signal symbols:

| Concern | Location (indicative) |
|---------|------------------------|
| Memory shed threshold + loop | `MEMORY_SHED_FREE_MB_THRESHOLD`, scheduler tail after per-service analytics |
| `service_analytics` / hourly buckets | `state["analytics"]` updates in scheduler |
| n8n merge | `get_n8n_workflow_windows`, `_n8n_windows_from_file`, `_n8n_windows_from_api` |
| `status.json` fields | Handler building JSON with `n8n_workflow_windows`, `service_analytics`, `recent_events`, `summary.scheduler_interval_sec` |

StdOut does **not** ship the shedding loop; it consumes the published JSON contract.

---

## 8. Appendix D — Archived: brief / workspace mismatch incident

A prior automation run conflated two workstreams: (1) a **retro security audit** targeting StdOut’s Astro layout, and (2) **Windlass Phase 4** spanning StdOut and the engine. A “wrong workspace / HALTED” note was inserted into `RETRO_QA.md`, which **invalidated QA traceability** even though Phase 4 work belonged in this repo and `~/Projects/windlass`. That note is **not** a technical blocker; this document restores explicit mappings and verification ownership.

---

## 9. Appendix E — Residual risks and limits

- **Digest scheduling:** Besides operator cron (`weekly-digest` route), `maybeSendWeeklyDigest` runs only on **Sunday UTC** after a successful sync, with a **6-day** cooldown — operators relying solely on that path may see timing skew vs local timezone expectations; prefer explicit cron for production SLAs.
- **Authenticated digest secret:** When `WINDLASS_WEEKLY_DIGEST_SECRET` is set, **unauthenticated** `POST` still requires `X-Windlass-Digest-Secret`; **browser sessions** do not need the header (session auth replaces shared secret for interactive triggers).
- **SaaS mode:** Bulk unauthenticated digest remains disabled unless `STDOUT_MODE !== 'saas'` and secret-based criteria are met (`weekly-digest.ts`).
- **Windlass `/exec` policy parity:** Hardening in StdOut does not automatically harden the engine’s exec endpoint; treat engine upgrades as coupled with Auto-Fix reviews.

---

## Document history

| Date | Change |
|------|--------|
| 2026-05-12 | Restored structured audit + Phase 4 traceability; recorded security remediation and engine scope; added appendices for verification and archived HALTED context; added §5.1 line anchors and §5.2 digest curl examples; weekly-digest session vs secret behavior clarified in §9. |
