import http from 'node:http';
import https from 'node:https';
import { and, eq } from 'drizzle-orm';
import { decrypt } from './crypto';
import { getDb, schema } from './db';

export interface GrafanaConfig {
  url: string;
  token: string;
  orgId?: number;
}

interface GrafanaResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export function getGrafanaConfig(userId: string): GrafanaConfig | null {
  const db = getDb();
  const sources = db.select().from(schema.dataSources)
    .where(and(
      eq(schema.dataSources.userId, userId),
      eq(schema.dataSources.type, 'grafana'),
      eq(schema.dataSources.enabled, true),
    ))
    .limit(1)
    .all();

  if (sources.length === 0 || !sources[0].url) return null;

  return {
    url: sources[0].url.replace(/\/$/, ''), // remove trailing slash
    token: sources[0].token ? (decrypt(sources[0].token) || '') : '',
    orgId: sources[0].metadata?.orgId as number | undefined,
  };
}

function requestJSON<T>(
  url: URL,
  token: string,
  method = 'GET',
  body?: unknown,
  timeoutMs = 10000
): Promise<GrafanaResponse<T>> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const options = {
      method,
      timeout: timeoutMs,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = mod.request(url, options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({ data: parsed });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          resolve({ error: `JSON parse error: ${message}` });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Grafana request timeout'));
    });

    if (body && (method === 'POST' || method === 'PUT')) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Fetch list of dashboards from Grafana
 */
export async function listGrafanaDashboards(
  config: GrafanaConfig
): Promise<Array<{ uid: string; title: string; url: string }>> {
  const url = new URL(`${config.url}/api/search?type=dash-db`);
  const response = await requestJSON<Array<{ uid: string; title: string; url: string }>>(
    url,
    config.token
  );

  if (response.error || !response.data) {
    console.error('[Grafana] List dashboards failed:', response.error);
    return [];
  }

  return response.data.map(d => ({
    uid: d.uid,
    title: d.title,
    url: `${config.url}${d.url}`,
  }));
}

/**
 * Build Grafana dashboard URL with time range and variables
 */
export function buildGrafanaDashboardUrl(
  config: GrafanaConfig,
  dashboardUid: string,
  options?: {
    from?: number; // unix timestamp ms
    to?: number;
    vars?: Record<string, string>;
    panelId?: number;
  }
): string {
  const url = new URL(`${config.url}/d/${dashboardUid}`);

  if (options?.from) {
    url.searchParams.set('from', String(options.from));
  }
  if (options?.to) {
    url.searchParams.set('to', String(options.to));
  }
  if (options?.panelId) {
    url.searchParams.set('viewPanel', String(options.panelId));
  }
  if (options?.vars) {
    for (const [key, value] of Object.entries(options.vars)) {
      url.searchParams.set(`var-${key}`, value);
    }
  }

  return url.toString();
}

/**
 * Create snapshot of a Grafana dashboard (for incident archival)
 */
export async function createGrafanaSnapshot(
  config: GrafanaConfig,
  dashboardUid: string,
  options?: {
    expires?: number; // seconds
    name?: string;
  }
): Promise<{ url: string; deleteUrl: string } | null> {
  const url = new URL(`${config.url}/api/snapshots`);

  const response = await requestJSON<{ url: string; deleteUrl: string }>(
    url,
    config.token,
    'POST',
    {
      dashboard: { uid: dashboardUid },
      expires: options?.expires || 86400, // 1 day default
      name: options?.name || `Snapshot ${new Date().toISOString()}`,
    }
  );

  if (response.error || !response.data) {
    console.error('[Grafana] Snapshot creation failed:', response.error);
    return null;
  }

  return response.data;
}
