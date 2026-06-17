/**
 * Observatory Startup Hook
 *
 * This runs EVERY TIME the StdOut service starts:
 * - Fresh boot
 * - Container restart
 * - Service interruption recovery
 * - Manual restart
 *
 * Ensures Observatory always comes online with full knowledge and readiness.
 */

import { initializeObservatory, isObservatoryReady } from './initialization';
import { getCentralDb } from '../db';
import { sql } from 'drizzle-orm';

export interface StartupResult {
  success: boolean;
  mode: 'full_init' | 'quick_resume' | 'recovery';
  duration_ms: number;
  ready: boolean;
  issues: string[];
  log: string[];
}

/**
 * Run Observatory startup sequence
 *
 * Call this in the StdOut service entry point (e.g., server startup middleware)
 */
export async function startupObservatory(): Promise<StartupResult> {
  const startTime = Date.now();
  const log: string[] = [];
  const issues: string[] = [];

  log.push('🌅 Observatory Startup Hook Triggered');
  log.push(`Time: ${new Date().toISOString()}`);
  log.push('');

  try {
    // Check if this is a fresh start or recovery
    const lastStartup = await getLastStartupTime();
    const timeSinceLastStartup = lastStartup ? Date.now() - lastStartup : Infinity;

    let mode: 'full_init' | 'quick_resume' | 'recovery';

    if (!lastStartup) {
      mode = 'full_init';
      log.push('Mode: FULL INITIALIZATION (first startup)');
    } else if (timeSinceLastStartup < 60000) {
      // Less than 1 minute - likely a quick restart
      mode = 'quick_resume';
      log.push('Mode: QUICK RESUME (recent restart)');
      log.push(`Last startup: ${Math.floor(timeSinceLastStartup / 1000)}s ago`);
    } else {
      // More than 1 minute - treat as recovery from interruption
      mode = 'recovery';
      log.push('Mode: RECOVERY (service was interrupted)');
      log.push(`Last startup: ${new Date(lastStartup).toLocaleString()}`);
    }

    log.push('');

    // Run full initialization sequence
    const initResult = await initializeObservatory();

    // Merge logs
    log.push(...initResult.startupLog);

    // Check readiness
    const readiness = isObservatoryReady(initResult);

    if (!readiness.ready) {
      log.push('');
      log.push('⚠️ Observatory Not Fully Ready');
      log.push('Missing components:');
      readiness.missingComponents.forEach((comp) => log.push(`  - ${comp}`));
      issues.push(...readiness.missingComponents);
    }

    if (readiness.recommendations.length > 0) {
      log.push('');
      log.push('💡 Recommendations:');
      readiness.recommendations.forEach((rec) => log.push(`  - ${rec}`));
    }

    // Record this startup
    await recordStartupTime(initResult.success);

    const duration = Date.now() - startTime;
    log.push('');
    log.push(`⏱️ Startup completed in ${duration}ms`);

    return {
      success: initResult.success,
      mode,
      duration_ms: duration,
      ready: readiness.ready,
      issues,
      log
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);
    log.push('');
    log.push(`❌ Startup FAILED: ${msg}`);
    issues.push(msg);

    return {
      success: false,
      mode: 'recovery',
      duration_ms: duration,
      ready: false,
      issues,
      log
    };
  }
}

/**
 * Get last startup timestamp from database
 */
async function getLastStartupTime(): Promise<number | null> {
  try {
    const db = getDb();
    const row = await db.get(
      sql`SELECT value FROM system_state WHERE key = 'observatory_last_startup'`
    ) as { value: string } | undefined;

    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Record startup time in database
 */
async function recordStartupTime(success: boolean): Promise<void> {
  try {
    const db = getDb();
    const now = Date.now();
    const nowStr = now.toString();

    // Ensure system_state table exists
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Upsert last startup time
    await db.run(sql`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('observatory_last_startup', ${nowStr}, ${now})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    // Record total startup count
    const countRow = await db.get(
      sql`SELECT value FROM system_state WHERE key = 'observatory_startup_count'`
    ) as { value: string } | undefined;

    const count = countRow ? parseInt(countRow.value, 10) + 1 : 1;
    const countStr = count.toString();

    await db.run(sql`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('observatory_startup_count', ${countStr}, ${now})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    // Record last successful startup
    if (success) {
      await db.run(sql`
        INSERT INTO system_state (key, value, updated_at)
        VALUES ('observatory_last_successful_startup', ${nowStr}, ${now})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
    }
  } catch (error) {
    console.error('[Observatory Startup] Failed to record startup time:', error);
  }
}

/**
 * Get startup statistics
 */
export async function getStartupStats(): Promise<{
  totalStartups: number;
  lastStartup: Date | null;
  lastSuccessfulStartup: Date | null;
  uptimeSinceLastStartup: number;
}> {
  try {
    const db = getDb();

    const countRow = await db.get(
      sql`SELECT value FROM system_state WHERE key = 'observatory_startup_count'`
    ) as { value: string } | undefined;

    const lastRow = await db.get(
      sql`SELECT value FROM system_state WHERE key = 'observatory_last_startup'`
    ) as { value: string } | undefined;

    const lastSuccessRow = await db.get(
      sql`SELECT value FROM system_state WHERE key = 'observatory_last_successful_startup'`
    ) as { value: string } | undefined;

    const lastStartup = lastRow ? new Date(parseInt(lastRow.value, 10)) : null;

    return {
      totalStartups: countRow ? parseInt(countRow.value, 10) : 0,
      lastStartup,
      lastSuccessfulStartup: lastSuccessRow ? new Date(parseInt(lastSuccessRow.value, 10)) : null,
      uptimeSinceLastStartup: lastStartup ? Date.now() - lastStartup.getTime() : 0
    };
  } catch {
    return {
      totalStartups: 0,
      lastStartup: null,
      lastSuccessfulStartup: null,
      uptimeSinceLastStartup: 0
    };
  }
}

/**
 * Format startup result for logging
 */
export function formatStartupResult(result: StartupResult): string {
  return result.log.join('\n');
}
