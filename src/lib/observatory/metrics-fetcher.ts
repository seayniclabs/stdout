/**
 * Live metric ingestion from Prometheus (Charlie 2026-06-12).
 *
 * The Sentinel's `runScheduledCheck` previously fed an EMPTY metric snapshot, so anomaly detection
 * never actually ran — the eyes were open but seeing nothing. This fetches the real resource metrics
 * the baselines compare against (cpu_percent, memory_percent, disk_percent, network_errors) from
 * Prometheus (cAdvisor container metrics), so the Watcher/Sentinel detect on live data.
 *
 * Metric names match what the baselines + sentinel use. Values are host-aggregate (the discovered
 * stack represents the local host). Best-effort: any query failure yields no value for that metric
 * (the snapshot simply omits it), and an empty snapshot means "no data this tick" — never an error.
 */

import { getTenantDb } from '../db';
import { sql } from 'drizzle-orm';

interface PromResult {
  data?: { result?: Array<{ value?: [number, string] }> };
  status?: string;
}

/** The PromQL for each metric we care about. Host-aggregate over all containers via cAdvisor. */
const QUERIES: Record<string, string> = {
  // Average CPU across containers as a percentage (rate of cpu seconds * 100).
  cpu_percent: 'avg(rate(container_cpu_usage_seconds_total{image!=""}[2m])) * 100',
  // Memory used as a percentage of machine memory.
  memory_percent: 'sum(container_memory_usage_bytes{image!=""}) / on() machine_memory_bytes * 100',
  // Root filesystem usage percentage (max across devices).
  disk_percent: 'max(container_fs_usage_bytes{device=~"/dev/.*"}) / on() max(container_fs_limit_bytes{device=~"/dev/.*"}) * 100',
  // Network receive+transmit errors per second across containers.
  network_errors: 'sum(rate(container_network_receive_errors_total[2m]) + rate(container_network_transmit_errors_total[2m]))',
};

async function promQuery(baseUrl: string, query: string): Promise<number | null> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as PromResult;
    if (data.status !== 'success') return null;
    const first = data.data?.result?.[0]?.value?.[1];
    if (first == null) return null;
    const n = Number(first);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Prometheus base URL: the user's configured `prometheus` data source, else the
 * PROMETHEUS_URL env (the loopback-published observatory Prometheus).
 */
function resolvePrometheusUrl(userId: string): string | null {
  try {
    const db = getTenantDb(userId);
    const row = db.get(sql`
      SELECT url FROM data_sources
      WHERE user_id = ${userId} AND type = 'prometheus' AND enabled = 1
      ORDER BY updated_at DESC LIMIT 1
    `) as { url: string } | undefined;
    if (row?.url) return row.url;
  } catch { /* fall through to env */ }
  return process.env.PROMETHEUS_URL || null;
}

/**
 * Fetch the current resource metrics for a host/stack. Returns only the metrics that resolved —
 * an empty object means Prometheus had no data (don't fabricate zeros, which would trip baselines).
 */
export async function fetchLiveMetrics(userId: string): Promise<Record<string, number>> {
  const base = resolvePrometheusUrl(userId);
  if (!base) return {};

  const out: Record<string, number> = {};
  await Promise.all(
    Object.entries(QUERIES).map(async ([name, q]) => {
      const v = await promQuery(base, q);
      if (v != null) out[name] = Math.round(v * 100) / 100;
    }),
  );
  return out;
}
