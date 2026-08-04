---
tags: [stdout, lessons, riggins, infrastructure]
created: 2026-07-30
status: active
---

# Riggins discovery API unreachable (2026-07-30)

## Problem
Task #1015388 asked to verify Riggins passive discovery via `GET http://192.168.68.80:8112/api/discovered-apps`. Request failed to connect entirely.

## Root cause
- `192.168.68.80` is a stale IP — the Mac Mini's actual address is `192.168.68.78` (confirmed in memory `lab_network_topology`).
- Even on the correct IP, `192.168.68.78:8112` returned TCP `connection refused` — the port is closed, not just wrong-hosted. Other services on the same host (SSH:22, Bridge:8117) responded normally, which rules out a network/sandbox routing issue and confirms the `stdout` container itself is down or not publishing port 8112 (compose maps `8112:3000`, container name `stdout`).

## Fix
Not fixed in this session — requires `docker ps`/`docker logs`/restart on the Mac Mini, which the verification sandbox has no SSH credentials for. Filed follow-up task #1015578 for CHARLIE (owner with Mac Mini access) to restart/investigate.

## Rule for next time
Before assuming a discovery/watcher logic bug when an API check fails, verify at the TCP layer against a known-good port on the *same host* (e.g. SSH:22, another service port) to distinguish "host/network unreachable" from "this one service is down" from "the logic ran but found nothing." Also: always use `192.168.68.78` for the Mac Mini, not `.80` — the CLAUDE.md quick-reference table is stale on this point.

## Addendum (2026-07-30, re-run of #1015388)
This task auto-retried 5x today (08:17–09:02) via `verify-shipped`, all failing identically. Re-checked with direct local `docker` access on the Mac Mini (this execution *does* have that access, correcting the assumption above that the sandbox lacks it):
- `docker ps -a` shows **no `stdout` container at all** — not running, not stopped, not created. It's fully absent, one step worse than "port closed."
- `docker compose ps -a` from `~/Projects/stdout` (the compose project defining `container_name: stdout`, `8112:3000`) returns zero rows — confirms it was never started (or was `docker rm`'d) under this compose project on this host.
- Also dead: the `socat TCP-LISTEN:18112 → 192.168.0.244:8112` forwarder (root process, pre-existing) — so there's no live StdOut instance reachable via that alternate route either.
- Images are present locally (`charlieseay/stdout:latest`, `stdout:latest`, etc.) so a `docker compose up -d` from `~/Projects/stdout` would likely resolve this — but that's a service restart, out of scope for a verify-only task. Left for #1015578 (CHARLIE, still `pending`).

## Addendum (2026-08-03, task #1015834 — 3rd duplicate dispatch)
Re-verified 4 days later; identical failure, service still down:
- `192.168.68.80:8112` — connection times out ("Host is down" at TCP layer); confirms this IP is stale for this host, not just wrong-ported.
- `192.168.68.78:8112` — `connection refused` from three independent checks (`nc`, `curl -v`, direct API GET). Same-host known-good port `192.168.68.78:5682` (helmsman REST) responded `200` in the same session, so this is not a sandbox/network routing artifact — the `stdout` container is specifically down.
- This session's sandbox has **no SSH credentials** for the Mac Mini (`Permission denied (publickey,password,keyboard-interactive)` on `charlie@192.168.68.78`), and the `mac-mini` docker context (`ssh://charlie@192.168.68.80`, also stale-IP'd) hung indefinitely rather than failing fast — killed manually after ~90s. So the "this execution has direct docker access" note from the 2026-07-30 addendum does NOT hold generally; it was specific to whatever execution ran that check, not a standing capability of this sandbox.
- **Task #1015578** (CHARLIE, filed 2026-07-30 to restart/investigate) is now `status=cancelled` in helmsman.db, not `shipped` — it was closed without the container ever being restarted. This is the actual gap: the fix task exists, was correctly diagnosed, and died on cancellation instead of completion.
- **Do not re-dispatch another verify-only task for this.** The verification logic is not broken and doesn't need re-diagnosis a 4th time. What's needed is: (a) reopen or re-file a CHARLIE-owned task to actually run `docker compose up -d` from `~/Projects/stdout` on the Mac Mini, since the images are already present locally, and (b) whoever cancelled #1015578 should note why, so it doesn't happen again silently.

## Addendum (2026-08-03, task #1015900 — researching origin task #1015364)

Task #1015364 ("Fix Riggins passive discovery," created 2026-07-30T00:01:33Z, same day as the rest of this saga) is actually the **origin** of this whole chain — it predates #1015388 by hours and is a *Fix* task, not a verify task. Its brief instructed: step 1 `SSH 192.168.68.89`, then `docker exec stdout sqlite3 ...` on that host, then read/patch `autonomous-watcher.ts:367-377` (the exact discovery block this whole saga is about). It failed with `error_type: timeout`, `last_failure_output: "Task execution timed out after 300 seconds"`, `qa_results.summary: "Agent reported failure: max iterations reached"`.

**Root cause, tied to the now-established finding in `project_claude_code_sandbox_no_lan_access`:** this execution sandbox has zero route to `192.168.68.0/24` — but critically, `ssh` to an unreachable LAN host does not fail instantly like `curl`/`nc` did in the 2026-08-03 addendum above (those returned in ~0ms, "no route to host"). SSH's initial TCP handshake against a silently-dropping/firewalled path hangs until an OS-level connect timeout (the mac-mini docker context in the same investigation hung ~90s before being killed manually). An agent retrying "SSH 192.168.68.89" across several iterations, each hanging tens of seconds, exhausts the 300s task budget without ever getting a clean error to reason about — surfacing as `timeout` + `max iterations reached` instead of the instant `connection refused`/`no route to host` seen in curl-based verify tasks. This is the same environmental root cause, manifesting differently because the brief used SSH instead of HTTP.

**Not a false premise on the IP this time:** unlike `192.168.68.80` (confirmed stale for the Mac Mini), `192.168.68.89` is a real, currently-documented host — `stdout-satellite/internal/config/config.go`'s `DiscoveryCandidates` list labels it `"ThinkPad P1 Gen 6 active IP"`. So this brief's target host was correct; the failure is 100% sandbox environmental isolation, not a bad citation.

**Status check (2026-08-03):** follow-up fix task #1015578 (CHARLIE) is still `status: cancelled`, `updated_at: 2026-07-30T17:18:10Z` — never completed. No new pending Riggins/StdOut tasks exist in helmsman.db as of this check. The underlying fix (get the `stdout` container running again on whichever host is canonical, then patch/verify the `autonomous-watcher.ts` discovery block) remains undone.

**Rule for next time (generalizes the existing one above):** any brief step that requires **interactive network access to a LAN host** — `ssh`, `docker exec` over a remote context, `docker compose` against a remote daemon — will hang (not fail-fast) from this sandbox and burn the entire task timeout as wasted iterations. Before dispatching a "Fix"-type task whose steps open with `SSH <lan-ip>`, check whether the target execution environment actually has LAN routing (`ifconfig | grep "inet 192.168"`); if not, route the task to an agent/session with real LAN access (interactive Mac Mini session, or the satellite's own local agent) instead of a Claude Code CLI sandbox dispatch. Symptom fingerprint to watch for: `error_type: timeout` + `qa_results` mentioning "max iterations reached" on any brief whose first step is SSH/remote-docker into a `192.168.x` host — this is the SSH-hang variant of the same sandbox-isolation bug, not a new watcher/discovery logic defect.

## Addendum (2026-08-03, task #1015945 — researching #1015834, 6th touch on this saga)

Re-confirmed from a session with direct local `docker` access (no SSH needed this time): `docker ps -a | grep -iE "stdout|riggins|observatory|windlass"` returns **zero rows**. `/Volumes/data/containers/stdout/docker-compose.yml` exists and is valid (`docker compose config` parses clean) — defines `stdout` (port `8112:3000`) and `windlass` (`8115:8115`) services. The image is present and ready: `charlieseay/stdout:latest` (186MB, `docker image inspect` succeeds). Nothing is blocking a restart — this is a pure "never (re)started" gap, not a build/pull/config problem.

**Escalation status:** the designated fix task **#1015578** (CHARLIE) has sat `status: cancelled` since 2026-07-30T17:18:10Z with no replacement filed — 4+ days and at least 4 duplicate verify-task dispatches (#1015388, #1015578-origin, #1015834, #1015900, #1015945) have re-diagnosed the identical root cause without anyone re-opening the actual fix. No new pending Riggins/StdOut task exists in helmsman.db as of this check.

**Rule for next time:** stop dispatching `verify`-type Riggins/StdOut discovery tasks — the verification logic was never the problem and 4+ identical re-diagnoses confirm it. The one action that closes this permanently is a single `owner=CHARLIE` (or any lane with direct Mac Mini docker access) task: `cd /Volumes/data/containers/stdout && docker compose up -d`, then confirm `curl http://192.168.68.78:8112/healthz` returns 200. Until that specific task is filed **and completed** (not cancelled), every subsequent dispatch against this target will duplicate this exact finding. Filed follow-up task via this session — see helmsman.db.
