# Retro QA — HALTED (attempt 3)

**Status:** Not executed. Brief targets the wrong workspace.

## Why

The brief asks for an audit of `~/Projects/stdout/src/` and pre-flags three files
as known-bad:

- `src/server/voice-registry-db.ts` — SQL injection, "fix this"
- `src/server/parsers.ts` — hardcoded paths, CRITICAL
- `src/routes/services/+page.ts` — hardcoded paths, CRITICAL

None of these exist in `~/Projects/stdout/`. Verified:

```
$ find ~/Projects/stdout -name "voice-registry-db*" -o -name "parsers.ts"
(no output)
$ find ~/Projects -maxdepth 4 -name "voice-registry-db*"
/Users/charlieseay/Projects/bridge/src/server/voice-registry-db.ts
$ find ~/Projects -maxdepth 4 -name "parsers.ts"
/Users/charlieseay/Projects/bridge/src/server/parsers.ts
```

`src/routes/services/+page.ts` does not exist anywhere on disk.

`stdout` is an Astro app, not SvelteKit:

- Has: `src/pages/`, `src/lib/`, `src/middleware.ts`, `src/layouts/`, `src/components/`
- No `src/server/` directory
- No `src/routes/` directory (`routes/+page.ts` is SvelteKit syntax)

The two named files live in `bridge`, which is the workspace the dispatch
routed me to (`DISPATCH:claude:320:/Users/charlieseay/Projects/bridge`).

## Diagnosis

Brief/workspace mismatch. Either the brief was authored against `bridge` and
mis-labeled `stdout`, or the dispatch routed to the wrong workspace. Per
memory `ref_dispatch_project_name_rule.md`, wrong project causes false QA
failures — which matches the attempt 1 and 2 transcripts (one side claims
files are missing, the other side claims they exist).

## Action

Holding delivery. Producing findings against `stdout` for files that don't
exist there would reproduce the exact hallucination QA flagged. Re-dispatch
needs one of:

1. **If the target is `bridge`:** rewrite brief path as
   `~/Projects/bridge/src/`, output `~/Projects/bridge/RETRO_QA.md`.
2. **If the target is `stdout`:** drop the three pre-flagged files (they're
   not in this codebase) and re-scope to Astro paths: `src/pages/app/api/*`,
   `src/lib/*`, `src/middleware.ts`.

No fabricated findings produced. No commit.
