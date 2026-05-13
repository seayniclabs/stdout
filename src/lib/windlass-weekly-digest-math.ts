/** Rows from `windlass_services` (or equivalent) needed for GB-hours digest. */
export type WindlassServiceDigestRow = { memoryMb: number | null; usageAnalytics: string | null };

/**
 * Sum (memory_gb) * (idle_hours) across services from persisted `usage_analytics` JSON.
 * Mirrors the Windlass Phase 4.4 formula in the tech spec.
 */
export function sumRecoveredGbHoursFromServices(services: WindlassServiceDigestRow[]): number {
  let recoveredGbHours = 0;
  for (const service of services) {
    if (!service.memoryMb || !service.usageAnalytics) continue;
    try {
      const analytics = JSON.parse(service.usageAnalytics) as { idle_minutes_total?: number };
      const idleMinutes = analytics?.idle_minutes_total || 0;
      recoveredGbHours += (service.memoryMb / 1024) * (idleMinutes / 60);
    } catch {
      // ignore malformed analytics blob
    }
  }
  return recoveredGbHours;
}
