import http from 'node:http';
import https from 'node:https';
import { getDb, schema } from './db';
import { decrypt } from './crypto';
import { eq, and } from 'drizzle-orm';

// --- Types ---

export interface InfluxConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

export interface MetricPoint {
  time: string;  // ISO timestamp
  value: number;
}

export interface ContainerMetrics {
  cpu: MetricPoint[];
  memory: MetricPoint[];
  network: MetricPoint[];  // bytes per second (combined rx+tx)
}

export interface ResourceSnapshot {
  containerName: string;
  cpuPercent: number | null;
  memoryMB: number | null;
  memoryPercent: number | null;
  networkBytesPerSec: number | null;
  timestamp: string | null;
}

// --- Query Cache ---

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const queryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute

function getCached<T>(key: string): T | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    queryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  // Evict expired entries if cache is large
  if (queryCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of queryCache) {
      if (now > v.expiresAt) queryCache.delete(k);
    }
  }
  queryCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Get Data Source Config ---

/**
 * Retrieve the first enabled InfluxDB data source for a user.
 * Returns null if none configured. Decrypts the token.
 */
export function getInfluxConfig(userId: string): InfluxConfig | null {
  const db = getDb();
  const ds = db.select().from(schema.dataSources)
    .where(and(
      eq(schema.dataSources.userId, userId),
      eq(schema.dataSources.type, 'influxdb'),
      eq(schema.dataSources.enabled, true),
    ))
    .limit(1)
    .all();

  if (ds.length === 0) return null;

  const source = ds[0];
  if (!source.url || !source.org || !source.bucket) return null;

  let token = '';
  if (source.token) {
    const decrypted = decrypt(source.token);
    token = decrypted || '';
  }

  return {
    url: source.url,
    token,
    org: source.org,
    bucket: source.bucket,
  };
}

// --- HTTP Helper ---

function influxQuery(config: InfluxConfig, flux: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/v2/query', config.url);
    url.searchParams.set('org', config.org);

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const body = JSON.stringify({
      query: flux,
      type: 'flux',
    });

    const timeout = setTimeout(() => {
      reject(new Error('InfluxDB query timeout'));
    }, timeoutMs);

    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/csv',
        ...(config.token ? { 'Authorization': `Token ${config.token}` } : {}),
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (res) => {
      clearTimeout(timeout);
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`InfluxDB ${res.statusCode}: ${body.substring(0, 200)}`));
        } else {
          resolve(body);
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// --- Health Check ---

/**
 * Test connection to InfluxDB. Returns { ok: true } or { ok: false, error: string }.
 */
export async function testConnection(config: InfluxConfig): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const url = new URL('/health', config.url);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Connection timeout' });
    }, 5000);

    const req = mod.get(url, {
      timeout: 5000,
      rejectUnauthorized: false,
      headers: config.token ? { 'Authorization': `Token ${config.token}` } : {},
    }, (res) => {
      clearTimeout(timeout);
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body.substring(0, 100)}` });
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message });
    });
  });
}

// --- CSV Parser ---

function parseInfluxCSV(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  // Find the header line (skip annotation rows starting with #)
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#') && lines[i].includes(',')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    // Skip empty/result rows
    if (row['_value'] !== undefined && row['_value'] !== '') {
      rows.push(row);
    }
  }

  return rows;
}

// --- Query Builders ---

/**
 * Query container CPU usage over a time range.
 * Returns percentage values (0-100).
 */
export async function queryContainerCPU(
  config: InfluxConfig,
  containerName: string,
  rangeMinutes = 60,
): Promise<MetricPoint[]> {
  const cacheKey = `cpu:${containerName}:${rangeMinutes}`;
  const cached = getCached<MetricPoint[]>(cacheKey);
  if (cached) return cached;

  const flux = `
    from(bucket: "${config.bucket}")
      |> range(start: -${rangeMinutes}m)
      |> filter(fn: (r) => r["_measurement"] == "docker_container_cpu")
      |> filter(fn: (r) => r["_field"] == "usage_percent")
      |> filter(fn: (r) => r["container_name"] == "${containerName}")
      |> aggregateWindow(every: ${Math.max(1, Math.floor(rangeMinutes / 30))}m, fn: mean, createEmpty: false)
      |> yield(name: "cpu")
  `;

  try {
    const csv = await influxQuery(config, flux);
    const rows = parseInfluxCSV(csv);
    const points = rows.map(r => ({
      time: r['_time'] || '',
      value: parseFloat(r['_value']) || 0,
    }));
    setCache(cacheKey, points);
    return points;
  } catch {
    return [];
  }
}

/**
 * Query container memory usage over a time range.
 * Returns values in MB.
 */
export async function queryContainerMemory(
  config: InfluxConfig,
  containerName: string,
  rangeMinutes = 60,
): Promise<MetricPoint[]> {
  const cacheKey = `mem:${containerName}:${rangeMinutes}`;
  const cached = getCached<MetricPoint[]>(cacheKey);
  if (cached) return cached;

  const flux = `
    from(bucket: "${config.bucket}")
      |> range(start: -${rangeMinutes}m)
      |> filter(fn: (r) => r["_measurement"] == "docker_container_mem")
      |> filter(fn: (r) => r["_field"] == "usage")
      |> filter(fn: (r) => r["container_name"] == "${containerName}")
      |> aggregateWindow(every: ${Math.max(1, Math.floor(rangeMinutes / 30))}m, fn: mean, createEmpty: false)
      |> map(fn: (r) => ({ r with _value: r._value / 1048576.0 }))
      |> yield(name: "mem")
  `;

  try {
    const csv = await influxQuery(config, flux);
    const rows = parseInfluxCSV(csv);
    const points = rows.map(r => ({
      time: r['_time'] || '',
      value: parseFloat(r['_value']) || 0,
    }));
    setCache(cacheKey, points);
    return points;
  } catch {
    return [];
  }
}

/**
 * Query container network I/O over a time range.
 * Returns bytes per second (rx + tx combined).
 */
export async function queryContainerNetwork(
  config: InfluxConfig,
  containerName: string,
  rangeMinutes = 60,
): Promise<MetricPoint[]> {
  const cacheKey = `net:${containerName}:${rangeMinutes}`;
  const cached = getCached<MetricPoint[]>(cacheKey);
  if (cached) return cached;

  const flux = `
    from(bucket: "${config.bucket}")
      |> range(start: -${rangeMinutes}m)
      |> filter(fn: (r) => r["_measurement"] == "docker_container_net")
      |> filter(fn: (r) => r["_field"] == "rx_bytes" or r["_field"] == "tx_bytes")
      |> filter(fn: (r) => r["container_name"] == "${containerName}")
      |> derivative(unit: 1s, nonNegative: true)
      |> aggregateWindow(every: ${Math.max(1, Math.floor(rangeMinutes / 30))}m, fn: mean, createEmpty: false)
      |> group(columns: ["_time"])
      |> sum()
      |> group()
      |> yield(name: "net")
  `;

  try {
    const csv = await influxQuery(config, flux);
    const rows = parseInfluxCSV(csv);
    const points = rows.map(r => ({
      time: r['_time'] || '',
      value: parseFloat(r['_value']) || 0,
    }));
    setCache(cacheKey, points);
    return points;
  } catch {
    return [];
  }
}

/**
 * Get all three metric types for a container around a specific timestamp.
 * Used for incident enrichment: queries +/- rangeMinutes around the timestamp.
 */
export async function queryContainerMetrics(
  config: InfluxConfig,
  containerName: string,
  rangeMinutes = 30,
): Promise<ContainerMetrics> {
  const [cpu, memory, network] = await Promise.all([
    queryContainerCPU(config, containerName, rangeMinutes),
    queryContainerMemory(config, containerName, rangeMinutes),
    queryContainerNetwork(config, containerName, rangeMinutes),
  ]);

  return { cpu, memory, network };
}

/**
 * Get current resource snapshots for all containers (or specific ones).
 * Used for HUD resource utilization cards.
 */
export async function queryCurrentResources(
  config: InfluxConfig,
  containerNames?: string[],
): Promise<ResourceSnapshot[]> {
  const cacheKey = `resources:${(containerNames || []).join(',')}`;
  const cached = getCached<ResourceSnapshot[]>(cacheKey);
  if (cached) return cached;

  const containerFilter = containerNames && containerNames.length > 0
    ? `|> filter(fn: (r) => ${containerNames.map(n => `r["container_name"] == "${n}"`).join(' or ')})`
    : '';

  // Query latest CPU
  const cpuFlux = `
    from(bucket: "${config.bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "docker_container_cpu")
      |> filter(fn: (r) => r["_field"] == "usage_percent")
      ${containerFilter}
      |> last()
      |> yield(name: "cpu")
  `;

  // Query latest memory
  const memFlux = `
    from(bucket: "${config.bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "docker_container_mem")
      |> filter(fn: (r) => r["_field"] == "usage" or r["_field"] == "usage_percent")
      ${containerFilter}
      |> last()
      |> yield(name: "mem")
  `;

  try {
    const [cpuCsv, memCsv] = await Promise.all([
      influxQuery(config, cpuFlux),
      influxQuery(config, memFlux),
    ]);

    const cpuRows = parseInfluxCSV(cpuCsv);
    const memRows = parseInfluxCSV(memCsv);

    // Build map by container name
    const snapshots = new Map<string, ResourceSnapshot>();

    for (const row of cpuRows) {
      const name = row['container_name'] || '';
      if (!name) continue;
      if (!snapshots.has(name)) {
        snapshots.set(name, {
          containerName: name,
          cpuPercent: null,
          memoryMB: null,
          memoryPercent: null,
          networkBytesPerSec: null,
          timestamp: row['_time'] || null,
        });
      }
      snapshots.get(name)!.cpuPercent = parseFloat(row['_value']) || 0;
    }

    for (const row of memRows) {
      const name = row['container_name'] || '';
      if (!name) continue;
      if (!snapshots.has(name)) {
        snapshots.set(name, {
          containerName: name,
          cpuPercent: null,
          memoryMB: null,
          memoryPercent: null,
          networkBytesPerSec: null,
          timestamp: row['_time'] || null,
        });
      }
      const field = row['_field'] || '';
      const val = parseFloat(row['_value']) || 0;
      if (field === 'usage') {
        snapshots.get(name)!.memoryMB = Math.round(val / 1048576);
      } else if (field === 'usage_percent') {
        snapshots.get(name)!.memoryPercent = val;
      }
    }

    const result = Array.from(snapshots.values());
    setCache(cacheKey, result);
    return result;
  } catch {
    return [];
  }
}

/**
 * Extract a container name from an incident's monitor target or tags.
 * Best-effort: looks for Docker container names in the incident data.
 */
export function guessContainerName(incident: {
  title: string;
  description: string;
  tags?: string | null;
}): string | null {
  // Check tags first — hud monitors put container name in tags
  if (incident.tags) {
    const tags = incident.tags.split(',').map(t => t.trim());
    // Docker container names are typically lowercase with hyphens/underscores
    const dockerTag = tags.find(t =>
      t !== 'hud' && t !== 'auto' && t !== 'http' && t !== 'tcp' &&
      t !== 'docker' && t !== 'ping' && t !== 'dns' &&
      !['critical', 'high', 'medium', 'low'].includes(t)
    );
    if (dockerTag) return dockerTag;
  }

  // Try to extract from title (e.g., "n8n is down" -> "n8n")
  const titleMatch = incident.title.match(/^(.+?)\s+is\s+(down|degraded)/i);
  if (titleMatch) return titleMatch[1].toLowerCase().replace(/\s+/g, '-');

  return null;
}
