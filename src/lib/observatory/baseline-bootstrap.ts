/**
 * Provisional Baseline Bootstrap (P3)
 *
 * Real statistical baselines need ~7 days of data (observatory_baselines, computed from a
 * rolling window). Until then the Sentinel has NO baselines, so `checkStackForAnomalies`
 * early-returns null and the Watcher sits in "learning mode" doing nothing — the brain is
 * effectively blind on day one. The autonomic vision wants a clean baseline established
 * quickly so detection starts immediately and refines over time.
 *
 * This seeds a PROVISIONAL baseline per discovered stack for the core resource metrics,
 * using conservative defaults with a wide std-dev (loose thresholds → only egregious
 * anomalies fire on day one, avoiding false positives). It writes with a SHORT window so
 * it's distinguishable from a real 7-day baseline, and the UNIQUE(stack_id, metric_name)
 * constraint means the real baseline computation later overwrites it cleanly.
 *
 * Metric names match what the Sentinel/Watcher compare against (cpu_percent, memory_percent,
 * disk_percent, network_errors). Means/std-devs are deliberately generous starting points.
 */

import { getDb, getSqlite } from '../db';
import { sql } from 'drizzle-orm';

interface ProvisionalMetric {
  metric: string;
  mean: number;
  stdDev: number; // wide on purpose — provisional thresholds are loose
}

// Conservative day-one defaults. A 3σ band on these only trips on genuinely abnormal load.
const PROVISIONAL_METRICS: ProvisionalMetric[] = [
  { metric: 'cpu_percent', mean: 25, stdDev: 25 },     // alerts ~>100% sustained
  { metric: 'memory_percent', mean: 50, stdDev: 20 },  // alerts ~>110% (i.e. real pressure)
  { metric: 'disk_percent', mean: 50, stdDev: 18 },    // alerts ~>104%
  { metric: 'network_errors', mean: 0, stdDev: 5 },    // alerts on a real error burst
];

export interface BaselineBootstrapResult {
  stacksSeeded: number;
  baselinesWritten: number;
  log: string[];
}

/**
 * Seed provisional baselines for every stack the user has. Idempotent: re-running updates
 * the same rows (UNIQUE(stack_id, metric_name)) but only if they're still provisional —
 * a real baseline (wider window) is never clobbered by this.
 */
export async function establishProvisionalBaselines(userId: string): Promise<BaselineBootstrapResult> {
  const log: string[] = [];
  const central = getSqlite(); // Use raw SQLite client for reliable INSERT
  const tenant = getDb();

  const stacks = tenant.all(sql`
    SELECT id, name FROM stacks WHERE user_id = ${userId}
  `) as Array<{ id: string; name: string }>;

  if (stacks.length === 0) {
    log.push('No stacks yet — provisional baselines will seed once a stack is discovered');
    return { stacksSeeded: 0, baselinesWritten: 0, log };
  }

  const now = Date.now();
  // Short window marks these as provisional (a real baseline spans ~7 days).
  const windowStart = now - 5 * 60 * 1000; // 5-minute provisional window
  const PROVISIONAL_WINDOW_MS = 60 * 60 * 1000; // anything <1h wide is "provisional"

  let stacksSeeded = 0;
  let baselinesWritten = 0;

  for (const stack of stacks) {
    let wroteForStack = false;
    for (const m of PROVISIONAL_METRICS) {
      try {
        // Only seed if there is NO baseline yet, or the existing one is still provisional
        // (window < 1h). Never overwrite a real, wide-window baseline.
        const existing = central.prepare(`
          SELECT window_start, window_end FROM observatory_baselines
          WHERE stack_id = ? AND metric_name = ?
        `).get(stack.id, m.metric) as { window_start: number; window_end: number } | undefined;

        if (existing && (existing.window_end - existing.window_start) >= PROVISIONAL_WINDOW_MS) {
          continue; // real baseline present — leave it alone
        }

        const id = `bl_prov_${stack.id}_${m.metric}`;
        const monitorId = 'observatory';
        const baselineValue = String(m.mean);
        const sampleCount = 1;
        // Need to provide values for old columns (user_id, monitor_id, baseline_value) even though they're legacy
        // The schema has both old columns (from original design) and new columns (from statistical baseline expansion)
        // Using raw SQLite client with ON CONFLICT(id) since (stack_id, metric_name) doesn't have UNIQUE constraint
        central.prepare(`
          INSERT INTO observatory_baselines
            (id, user_id, monitor_id, stack_id, metric_name, baseline_value, mean, std_dev, sample_count, window_start, window_end, last_calculated_at, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            mean = excluded.mean,
            std_dev = excluded.std_dev,
            baseline_value = excluded.baseline_value,
            window_start = excluded.window_start,
            window_end = excluded.window_end,
            last_calculated_at = excluded.last_calculated_at,
            updated_at = excluded.updated_at
        `).run(
          id, userId, monitorId, stack.id, m.metric, baselineValue, m.mean, m.stdDev, sampleCount, windowStart, now, now, now, now
        );
        baselinesWritten++;
        wroteForStack = true;
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? `${error.message} | Stack: ${error.stack?.split('\n')[1]}` : String(error);
        log.push(`  ⚠ ${stack.name}/${m.metric}: ${errorMsg}`);
        console.error(`[Baseline Bootstrap Error] ${stack.name}/${m.metric}:`, error);
      }
    }
    if (wroteForStack) {
      stacksSeeded++;
      log.push(`  ✓ ${stack.name}: provisional baseline established (${PROVISIONAL_METRICS.length} metrics, loose thresholds)`);
    }
  }

  log.push(`Provisional baselines: ${baselinesWritten} written across ${stacksSeeded} stack(s) — Watcher exits learning mode, refines over 7 days`);
  return { stacksSeeded, baselinesWritten, log };
}
