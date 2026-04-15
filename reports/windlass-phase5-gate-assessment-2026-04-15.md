---
title: Windlass Phase 5 Gate Assessment
date: 2026-04-15
assessor: Codex (local, no external dispatch)
score: 1/10
decision: HOLD - NOT READY FOR PROMOTION
---

# Windlass Phase 5 Gate Assessment (Attempt 3 Recovery)

## Scope Evaluated

- Phase 5 definition from `FEAT-windlass-integration.md` and `Tech Spec - Windlass Integration.md`
- Current `stdout` codebase implementation status
- Current open bug context from project bug notes
- Windlass test status (`tests/windlass.spec.ts`)

## Phase 5 Criteria vs Current State

| Criterion | Status | Evidence |
|---|---|---|
| 5.1 `service_type` inference (workflow-engine, database, cache, etc.) | NOT MET | `service_type` exists, but values are schedule classes (`always`, `schedule`, `on-demand`, `manual`) in `src/lib/windlass.ts`, not the required architecture categories. |
| 5.2 `assessment_results` table | MISSING | No `assessment_results` table in `src/lib/db/tenant-schema.ts`. |
| 5.3 assessment runner | MISSING | No `assessment-runner.ts` or equivalent assessment engine implementation. |
| 5.4 Phase 5a rules (architecture/resource) | MISSING | No rule definitions or execution paths in repo. |
| 5.5 Phase 5b rules (reliability/security) | MISSING | No rule definitions or execution paths in repo. |
| 5.6 windlass-guides fetch + cache | MISSING | No fetcher/cache model for `seayniclabs/windlass-guides`. |
| 5.7 assessments UI routes | MISSING | No `/app/tools/windlass/assessments` routes (only index/services/alerts/timeline). |
| 5.8 HUD badge for findings | MISSING | No assessment issue badge wiring found. |
| 5.9 on-demand + weekly triggers | MISSING | No trigger route or scheduler for assessment runs. |
| 5.10 Pro gate | MISSING | Tier limits do not include an assessment-engine entitlement in `src/lib/tiers.ts`. |

## Open Bug Context Against Gate

- Active bug files are mostly platform-wide and not direct Phase 5 blockers, but they add release risk:
  - `BUG-security-sweep-2026-04-02.md` (active hardening backlog)
  - `test-suite-blockers.md` (active infra/testing tracking note)
- Windlass-specific stale registry bug is already resolved (`BUG-stale-service-registry.md`).
- Running `tests/windlass.spec.ts` currently fails 12/12 in this environment due to `ERR_CONNECTION_REFUSED` to `http://localhost:4321` (test harness/server availability issue), so there is no passing execution proof for current Windlass behavior in this run.

## Readiness Score

**1/10**

Rationale:
- The core Phase 5 capability (assessment engine + rules + guides ingestion + UI + triggers + gate) is not implemented.
- The one visible foundation step (`service_type`) is implemented with the wrong semantic model for Phase 5 rule targeting.
- Current run has no passing Windlass test confirmation.

## Promotion Decision

**Do not promote to Active. Hold at current phase.**

### Blockers (Must Resolve Before Promotion)

1. Correct `service_type` model to required service categories and infer from image patterns with override support.
2. Add `assessment_results` storage schema (+ any guide cache table needed).
3. Implement assessment runner and all Phase 5a + 5b rules.
4. Implement `windlass-guides` fetch/cache flow with missing-guide fallback behavior.
5. Ship `/app/tools/windlass/assessments` UI and details pages.
6. Add HUD findings badge and link to assessments.
7. Add on-demand + scheduled assessment triggers.
8. Add explicit tier gating for Assessment Engine (Pro tiers).
9. Restore passing Windlass test execution in CI/dev environment as gate evidence.

## If/When Score Reaches >=7 (Promotion Brief Template)

When blockers are resolved and evidence is green:
- Promote Windlass Phase 5 to Active.
- Require a release brief including: ruleset shipped, guide sync coverage, trigger schedule, tier gate verification, and passing WL + assessment-specific tests.
