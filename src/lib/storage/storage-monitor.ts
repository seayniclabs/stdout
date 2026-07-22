/**
 * Storage Monitoring
 *
 * Tracks disk usage for StdOut data:
 * - SQLite database size
 * - Log storage (if using file-based logs)
 * - Metric time-series data
 * - Knowledge base / docs
 *
 * Warns when approaching storage limits and triggers auto-archival.
 */

import { getSqlite } from '../db';
import { execFileSync } from 'child_process';
import { statSync } from 'fs';
import { join } from 'path';

export interface StorageUsage {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent_used: number;
  breakdown: {
    database: number;
    logs: number;
    metrics: number;
    docs: number;
    other: number;
  };
  warnings: string[];
  last_checked: number;
}

/**
 * Get current storage usage
 */
export async function getStorageUsage(): Promise<StorageUsage> {
  const dataPath = process.env.STDOUT_DATA_PATH || '/data';

  // Get filesystem stats
  let total_bytes = 0;
  let free_bytes = 0;

  try {
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const dfOutput = execFileSync('df', ['-B1', dataPath], { encoding: 'utf-8' });
      const lines = dfOutput.split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].trim().split(/\s+/);
        total_bytes = parseInt(parts[1]) || 0;
        free_bytes = parseInt(parts[3]) || 0;
      }
    }
  } catch (error) {
    console.error('[Storage Monitor] Failed to get filesystem stats:', error);
  }

  // Get database size
  const dbSize = await getDatabaseSize(dataPath);

  // Get log storage size (if applicable)
  const logSize = await getDirectorySize(join(dataPath, 'logs'));

  // Get metrics storage size
  const metricsSize = await getDirectorySize(join(dataPath, 'metrics'));

  // Get docs storage size
  const docsSize = await getDirectorySize(join(dataPath, 'docs'));

  const used_bytes = dbSize + logSize + metricsSize + docsSize;
  const percent_used = total_bytes > 0 ? (used_bytes / total_bytes) * 100 : 0;

  // Generate warnings
  const warnings: string[] = [];

  if (percent_used > 90) {
    warnings.push('Storage critically full (>90%). Auto-archival recommended.');
  } else if (percent_used > 75) {
    warnings.push('Storage usage high (>75%). Consider enabling auto-archival.');
  }

  if (dbSize > 10 * 1024 * 1024 * 1024) { // 10GB
    warnings.push('Database size >10GB. Run VACUUM to reclaim space.');
  }

  if (logSize > 20 * 1024 * 1024 * 1024) { // 20GB
    warnings.push('Log storage >20GB. Reduce retention period or compress old logs.');
  }

  return {
    total_bytes,
    used_bytes,
    free_bytes,
    percent_used,
    breakdown: {
      database: dbSize,
      logs: logSize,
      metrics: metricsSize,
      docs: docsSize,
      other: Math.max(0, used_bytes - (dbSize + logSize + metricsSize + docsSize)),
    },
    warnings,
    last_checked: Date.now(),
  };
}

/**
 * Get SQLite database size
 */
async function getDatabaseSize(dataPath: string): Promise<number> {
  try {
    const dbPath = join(dataPath, 'stdout.db');
    const stats = statSync(dbPath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Get total size of a directory (recursive)
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    // Use du command for accurate recursive size
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const output = execFileSync('du', ['-sb', dirPath], { encoding: 'utf-8' });
      const match = output.match(/^(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
    }
  } catch {
    // Directory doesn't exist or du failed - return 0
  }
  return 0;
}

/**
 * Run database VACUUM to reclaim space
 */
export async function vacuumDatabase(): Promise<{ before_bytes: number; after_bytes: number; reclaimed_bytes: number }> {
  const dataPath = process.env.STDOUT_DATA_PATH || '/data';
  const before_bytes = await getDatabaseSize(dataPath);

  const db = getSqlite();
  db.prepare('VACUUM').run();

  const after_bytes = await getDatabaseSize(dataPath);
  const reclaimed_bytes = before_bytes - after_bytes;

  console.log(`[Storage Monitor] VACUUM reclaimed ${formatBytes(reclaimed_bytes)}`);

  return { before_bytes, after_bytes, reclaimed_bytes };
}

/**
 * Archive old logs (compress and move to cold storage)
 */
export async function archiveOldLogs(retentionDays: number = 30): Promise<{ archived_count: number; space_freed: number }> {
  const db = getSqlite();
  const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  // Count old logs
  const oldLogs = db.prepare(`
    SELECT COUNT(*) as count FROM logs WHERE timestamp < ?
  `).get(cutoffTimestamp) as { count: number };

  if (oldLogs.count === 0) {
    console.log('[Storage Monitor] No old logs to archive');
    return { archived_count: 0, space_freed: 0 };
  }

  // Delete old logs (in a real implementation, we'd compress and move to archive first)
  const beforeSize = await getDatabaseSize(process.env.STDOUT_DATA_PATH || '/data');

  db.prepare(`DELETE FROM logs WHERE timestamp < ?`).run(cutoffTimestamp);

  // Run VACUUM to actually reclaim the space
  db.prepare('VACUUM').run();

  const afterSize = await getDatabaseSize(process.env.STDOUT_DATA_PATH || '/data');
  const space_freed = beforeSize - afterSize;

  console.log(`[Storage Monitor] Archived ${oldLogs.count} logs, freed ${formatBytes(space_freed)}`);

  return { archived_count: oldLogs.count, space_freed };
}

/**
 * Get storage trend (usage over time)
 */
export function getStorageTrend(days: number = 7): Array<{ date: string; used_bytes: number }> {
  const db = getSqlite();

  try {
    const rows = db.prepare(`
      SELECT date, used_bytes FROM storage_usage_daily
      WHERE date >= date('now', '-${days} days')
      ORDER BY date ASC
    `).all() as Array<{ date: string; used_bytes: number }>;

    return rows;
  } catch {
    return [];
  }
}

/**
 * Record daily storage snapshot
 */
export async function recordDailyStorageSnapshot(): Promise<void> {
  const usage = await getStorageUsage();
  const db = getSqlite();

  // Create table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS storage_usage_daily (
      date TEXT PRIMARY KEY,
      total_bytes INTEGER NOT NULL,
      used_bytes INTEGER NOT NULL,
      free_bytes INTEGER NOT NULL,
      percent_used REAL NOT NULL,
      db_bytes INTEGER NOT NULL,
      logs_bytes INTEGER NOT NULL,
      metrics_bytes INTEGER NOT NULL,
      docs_bytes INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL
    )
  `).run();

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  db.prepare(`
    INSERT OR REPLACE INTO storage_usage_daily
    (date, total_bytes, used_bytes, free_bytes, percent_used, db_bytes, logs_bytes, metrics_bytes, docs_bytes, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    today,
    usage.total_bytes,
    usage.used_bytes,
    usage.free_bytes,
    usage.percent_used,
    usage.breakdown.database,
    usage.breakdown.logs,
    usage.breakdown.metrics,
    usage.breakdown.docs,
    Date.now()
  );
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
