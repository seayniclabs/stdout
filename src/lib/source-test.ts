/**
 * Connection test functions for all data source types beyond InfluxDB/Prometheus.
 * Each function follows the same { ok, error? } return pattern.
 */

import http from 'node:http';
import https from 'node:https';

interface TestResult {
  ok: boolean;
  error?: string;
}

interface TestConfig {
  url: string;
  token?: string;
  username?: string;
  password?: string;
}

function httpGet(
  targetUrl: string,
  opts?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const timeout = opts?.timeoutMs ?? 5000;

    const timer = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, timeout);

    const req = mod.get(url, {
      timeout,
      rejectUnauthorized: false,
      headers: opts?.headers,
    }, (res) => {
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Trivy: GET {url}/healthz — expects 200 */
export async function testTrivyConnection(config: TestConfig): Promise<TestResult> {
  try {
    const { status } = await httpGet(`${config.url}/healthz`);
    if (status === 200) return { ok: true };
    return { ok: false, error: `Trivy returned HTTP ${status}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** Uptime Kuma: GET {url}/api/status-page/heartbeat, fall back to {url} — expects 200 */
export async function testUptimeKumaConnection(config: TestConfig): Promise<TestResult> {
  try {
    // Try the API endpoint first
    try {
      const { status } = await httpGet(`${config.url}/api/status-page/heartbeat`, {
        timeoutMs: 3000,
      });
      if (status === 200) return { ok: true };
    } catch { /* fall through */ }

    // Fall back to root
    const { status } = await httpGet(config.url);
    if (status === 200 || status === 302 || status === 301) return { ok: true };
    return { ok: false, error: `Uptime Kuma returned HTTP ${status}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** Loki: GET {url}/ready — expects body containing "ready" */
export async function testLokiConnection(config: TestConfig): Promise<TestResult> {
  try {
    const headers: Record<string, string> = {};
    if (config.token) headers['Authorization'] = `Bearer ${config.token}`;

    const { status, body } = await httpGet(`${config.url}/ready`, { headers });
    if (status === 200 && body.toLowerCase().includes('ready')) return { ok: true };
    if (status === 200) return { ok: true }; // Some Loki versions just return 200
    return { ok: false, error: `Loki returned HTTP ${status}: ${body.slice(0, 100)}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** Graylog: GET {url}/api/system with basic auth — expects 200 + JSON */
export async function testGraylogConnection(config: TestConfig): Promise<TestResult> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (config.username && config.password) {
      const creds = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    } else if (config.token) {
      // Token-based auth (session token)
      headers['X-Requested-By'] = 'StdOut';
      const creds = Buffer.from(`${config.token}:session`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    }

    const { status, body } = await httpGet(`${config.url}/api/system`, { headers });
    if (status === 200) {
      try {
        JSON.parse(body);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Graylog returned non-JSON response' };
      }
    }
    if (status === 401) return { ok: false, error: 'Authentication failed — check username/password' };
    return { ok: false, error: `Graylog returned HTTP ${status}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** CrowdSec: GET {url}/v1/decisions with API key header — expects 200 */
export async function testCrowdSecConnection(config: TestConfig): Promise<TestResult> {
  try {
    const headers: Record<string, string> = {};
    if (config.token) headers['X-Api-Key'] = config.token;

    const { status } = await httpGet(`${config.url}/v1/decisions`, { headers });
    // CrowdSec returns 200 (possibly with null body if no decisions)
    if (status === 200) return { ok: true };
    if (status === 403) return { ok: false, error: 'Authentication failed — check API key' };
    return { ok: false, error: `CrowdSec returned HTTP ${status}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** Pi-hole: GET {url}/admin/api.php?status — expects JSON with status field */
export async function testPiholeConnection(config: TestConfig): Promise<TestResult> {
  try {
    const { status, body } = await httpGet(`${config.url}/admin/api.php?status`);
    if (status === 200) {
      try {
        const data = JSON.parse(body);
        if (data.status !== undefined) return { ok: true };
        return { ok: false, error: 'Pi-hole returned unexpected JSON structure' };
      } catch {
        return { ok: false, error: 'Pi-hole returned non-JSON response' };
      }
    }
    return { ok: false, error: `Pi-hole returned HTTP ${status}` };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Connection failed' };
  }
}

/** Route a test to the correct function based on source type */
export async function testSourceConnection(
  type: string,
  config: TestConfig,
): Promise<TestResult> {
  switch (type) {
    case 'trivy':
      return testTrivyConnection(config);
    case 'uptime-kuma':
      return testUptimeKumaConnection(config);
    case 'loki':
      return testLokiConnection(config);
    case 'graylog':
      return testGraylogConnection(config);
    case 'crowdsec':
      return testCrowdSecConnection(config);
    case 'pihole':
      return testPiholeConnection(config);
    default:
      return { ok: false, error: `Unknown source type: ${type}` };
  }
}
