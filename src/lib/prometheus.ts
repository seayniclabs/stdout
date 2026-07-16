import http from 'node:http';
import https from 'node:https';
import { and, eq } from 'drizzle-orm';
import { decrypt } from './crypto';
import { getDb, schema } from './db';
import type { ContainerMetrics, MetricPoint, ResourceSnapshot } from './influx';

export interface PrometheusConfig {
  url: string;
  token: string;
}

type PrometheusVectorResult = {
  metric: Record<string, string>;
  value?: [number, string];
  values?: [number, string][];
};

interface PrometheusResponse {
  status: 'success' | 'error';
  data?: {
    resultType: 'vector' | 'matrix';
    result: PrometheusVectorResult[];
  };
  error?: string;
}

export function getPrometheusConfig(userId: string): PrometheusConfig | null {
  const db = getDb();
  const sources = db.select().from(schema.dataSources)
    .where(and(
      eq(schema.dataSources.userId, userId),
      eq(schema.dataSources.type, 'prometheus'),
      eq(schema.dataSources.enabled, true),
    ))
    .limit(1)
    .all();

  if (sources.length === 0 || !sources[0].url) return null;
  return {
    url: sources[0].url,
    token: sources[0].token ? (decrypt(sources[0].token) || '') : '',
  };
}

function requestJSON(url: URL, token: string, timeoutMs = 10000): Promise<PrometheusResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Prometheus ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
  });
}

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function labelMatcher(containerName: string): string {
  const n = escapePromLabel(containerName.trim());
  return `container=~"^${n}$|^/${n}$"`;
}

async function queryRange(config: PrometheusConfig, query: string, rangeMinutes: number): Promise<MetricPoint[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, rangeMinutes) * 60;
  const step = Math.max(15, Math.floor((rangeMinutes * 60) / 60)); // ~60 points

  const url = new URL('/api/v1/query_range', config.url);
  url.searchParams.set('query', query);
  url.searchParams.set('start', String(start));
  url.searchParams.set('end', String(end));
  url.searchParams.set('step', String(step));

  try {
    const json = await requestJSON(url, config.token);
    const points: MetricPoint[] = [];
    for (const series of json.data?.result || []) {
      for (const item of series.values || []) {
        const ts = item[0];
        const val = Number.parseFloat(item[1]);
        if (Number.isFinite(ts) && Number.isFinite(val)) {
          points.push({ time: new Date(ts * 1000).toISOString(), value: val });
        }
      }
    }
    return points.sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return [];
  }
}

async function queryInstantByContainer(config: PrometheusConfig, query: string): Promise<Map<string, number>> {
  const url = new URL('/api/v1/query', config.url);
  url.searchParams.set('query', query);
  const out = new Map<string, number>();
  try {
    const json = await requestJSON(url, config.token);
    for (const row of json.data?.result || []) {
      const container = row.metric.container || '';
      const value = row.value?.[1];
      const parsed = Number.parseFloat(value || 'NaN');
      if (container && Number.isFinite(parsed)) {
        out.set(container.replace(/^\//, ''), parsed);
      }
    }
  } catch {
    // Return empty map on query failures.
  }
  return out;
}

export async function testPrometheusConnection(config: PrometheusConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const readyUrl = new URL('/-/ready', config.url);
    const mod = readyUrl.protocol === 'https:' ? https : http;
    const ready = await new Promise<{ ok: boolean; body: string }>((resolve) => {
      const req = mod.get(readyUrl, {
        timeout: 5000,
        rejectUnauthorized: false,
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: res.statusCode === 200, body });
        });
      });
      req.on('error', () => resolve({ ok: false, body: '' }));
    });
    if (ready.ok) return { ok: true };

    const probeUrl = new URL('/api/v1/query', config.url);
    probeUrl.searchParams.set('query', 'up');
    const probe = await requestJSON(probeUrl, config.token, 5000);
    if (probe.status === 'success') return { ok: true };
    return { ok: false, error: probe.error || 'Prometheus query failed' };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

export async function queryPrometheusContainerMetrics(
  config: PrometheusConfig,
  containerName: string,
  rangeMinutes = 60,
): Promise<ContainerMetrics> {
  const matcher = labelMatcher(containerName);
  const cpuQuery = `sum(rate(container_cpu_usage_seconds_total{${matcher}}[2m])) * 100`;
  const memoryQuery = `max(container_memory_usage_bytes{${matcher}}) / 1048576`;
  const networkQuery = `sum(rate(container_network_receive_bytes_total{${matcher}}[2m]) + rate(container_network_transmit_bytes_total{${matcher}}[2m]))`;

  const [cpu, memory, network] = await Promise.all([
    queryRange(config, cpuQuery, rangeMinutes),
    queryRange(config, memoryQuery, rangeMinutes),
    queryRange(config, networkQuery, rangeMinutes),
  ]);

  return { cpu, memory, network };
}

export async function queryPrometheusCurrentResources(
  config: PrometheusConfig,
  containerNames?: string[],
): Promise<ResourceSnapshot[]> {
  const nameFilter = containerNames && containerNames.length > 0
    ? `container=~"${containerNames.map((n) => `^${escapePromLabel(n)}$|^/${escapePromLabel(n)}$`).join('|')}"`
    : 'container!=""';

  const [cpuMap, memMap, memPctMap] = await Promise.all([
    queryInstantByContainer(config, `sum by (container) (rate(container_cpu_usage_seconds_total{${nameFilter}}[2m])) * 100`),
    queryInstantByContainer(config, `max by (container) (container_memory_usage_bytes{${nameFilter}}) / 1048576`),
    queryInstantByContainer(config, `max by (container) (container_memory_working_set_bytes{${nameFilter}} / container_spec_memory_limit_bytes{${nameFilter}} * 100)`),
  ]);

  const keys = new Set<string>([...cpuMap.keys(), ...memMap.keys(), ...memPctMap.keys()]);
  return Array.from(keys).map((name) => ({
    containerName: name,
    cpuPercent: cpuMap.get(name) ?? null,
    memoryMB: memMap.get(name) ? Math.round(memMap.get(name) as number) : null,
    memoryPercent: memPctMap.get(name) ?? null,
    networkBytesPerSec: null,
    timestamp: new Date().toISOString(),
  }));
}
