/**
 * Observatory Data-Source Auto-Configuration (P3)
 *
 * The autonomic vision requires Observatory to auto-configure its data sources on first
 * boot — no human clicking "add data source". The Observatory stack (Prometheus, Loki,
 * Tempo, cAdvisor, Trivy) ships in the same compose at KNOWN endpoints, published
 * loopback-only (127.0.0.1:<port>). The Docker-`ps` scanner in src/lib/setup/data-sources.ts
 * can't see those because it parses `0.0.0.0:<port>->` from `docker ps`; loopback publishing
 * shows as `127.0.0.1:<port>->`. So this module probes the endpoints DIRECTLY by their
 * env-configured URLs and upserts the reachable ones into the data_sources table.
 *
 * Env (set by docker-compose.observatory.yml):
 *   PROMETHEUS_URL, LOKI_URL, TEMPO_URL, CADVISOR_URL, TRIVY_URL
 * Falls back to the canonical loopback ports if unset.
 */

import { getCentralDb } from '../db';
import { sql } from 'drizzle-orm';

interface ProbeTarget {
  type: string;          // data_sources.type enum value (must be in the schema enum to be queryable)
  name: string;          // human label
  url: string;           // base URL
  healthPath: string;    // path that returns 2xx when the service is up
  queryable: boolean;    // true if `type` is a real data_sources enum (prometheus/loki/trivy); else informational
}

function buildTargets(): ProbeTarget[] {
  const prom = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  const loki = process.env.LOKI_URL || 'http://localhost:3100';
  const tempo = process.env.TEMPO_URL || 'http://localhost:3200';
  const cadvisor = process.env.CADVISOR_URL || 'http://localhost:8181';
  const trivy = process.env.TRIVY_URL || 'http://localhost:4954';

  return [
    { type: 'prometheus', name: 'Observatory Prometheus', url: prom, healthPath: '/-/healthy', queryable: true },
    { type: 'loki', name: 'Observatory Loki', url: loki, healthPath: '/ready', queryable: true },
    { type: 'trivy', name: 'Observatory Trivy', url: trivy, healthPath: '/healthz', queryable: true },
    // Tempo + cAdvisor aren't data_sources enum types — recorded informationally so the
    // brain knows they exist, but they won't be picked up by getPrometheusConfig-style reads.
    { type: 'tempo', name: 'Observatory Tempo', url: tempo, healthPath: '/ready', queryable: false },
    { type: 'cadvisor', name: 'Observatory cAdvisor', url: cadvisor, healthPath: '/healthz', queryable: false },
  ];
}

async function probe(target: ProbeTarget, timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetch(new URL(target.healthPath, target.url).toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface DataSourceConfigResult {
  configured: number;
  reachable: string[];
  unreachable: string[];
  log: string[];
}

/**
 * Probe the known Observatory endpoints and upsert reachable QUERYABLE sources into
 * data_sources for the given user. Idempotent (stable id per type → ON CONFLICT(id)).
 * Informational-only services (tempo/cadvisor) are probed and logged but not inserted,
 * because data_sources.type rejects them. The live table has user_id NOT NULL and NO
 * unique index on url, so we key on the primary key (id) and always set user_id.
 */
export async function autoConfigureDataSources(userId: string): Promise<DataSourceConfigResult> {
  const log: string[] = [];
  const reachable: string[] = [];
  const unreachable: string[] = [];
  let configured = 0;

  const db = getCentralDb();
  const targets = buildTargets();

  for (const t of targets) {
    const up = await probe(t);
    if (!up) {
      unreachable.push(t.name);
      log.push(`  ✗ ${t.name} unreachable at ${t.url} — skipping`);
      continue;
    }
    reachable.push(t.name);

    if (!t.queryable) {
      log.push(`  ✓ ${t.name} reachable (informational — not a data_sources type)`);
      continue;
    }

    try {
      // Stable, user-scoped id so re-runs update the same row (no UNIQUE on url in the live table).
      const sourceId = `ds_obs_${t.type}_${userId}`;
      const now = Date.now();
      await db.run(sql`
        INSERT INTO data_sources (id, user_id, type, name, url, enabled, last_tested_at, last_test_status, created_at, updated_at)
        VALUES (${sourceId}, ${userId}, ${t.type}, ${t.name}, ${t.url}, 1, ${now}, 'ok', ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET
          type = ${t.type},
          name = ${t.name},
          url = ${t.url},
          enabled = 1,
          last_tested_at = ${now},
          last_test_status = 'ok',
          updated_at = ${now}
      `);
      configured++;
      log.push(`  ✓ ${t.name} configured (${t.type} @ ${t.url})`);
    } catch (err: any) {
      log.push(`  ⚠ ${t.name} reachable but DB upsert failed: ${err.message}`);
    }
  }

  log.push(`Data sources: ${configured} configured, ${reachable.length} reachable, ${unreachable.length} unreachable`);
  return { configured, reachable, unreachable, log };
}
