/**
 * NVD CVE Scanner — native StdOut replacement for n8n l3GcRp0k3IygRBtC
 *
 * Weekly (Sunday 14:00 UTC / 8AM CT). Queries NVD API for HIGH+CRITICAL
 * CVEs published in the last 30 days for tracked container images.
 * Fires a single summary alert via the Windlass alert router.
 */

import { fireAlert } from './alert-router';
import { getDb, schema } from './db';

const IMAGES = [
  'nginx-proxy-manager', 'homepage', 'authentik', 'vaultwarden', 'portainer-ce',
  'grafana', 'influxdb', 'telegraf',
  'postgres', 'redis', 'elasticsearch',
  'n8n', 'miniflux', 'filebrowser', 'umami', 'postiz-app',
  'netdata',
];

interface CveResult {
  image: string;
  cveId: string;
  severity: string;
  score: number;
  published: string;
  description: string;
}

async function queryNvd(imageName: string): Promise<CveResult[]> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(imageName)}&resultsPerPage=5`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const results: CveResult[] = [];
    for (const vuln of data.vulnerabilities ?? []) {
      const cve = vuln.cve ?? {};
      const published = cve.published ? new Date(cve.published) : null;
      if (!published || published < thirtyDaysAgo) continue;
      const metrics = cve.metrics ?? {};
      let severity = 'UNKNOWN';
      let score = 0;
      if (metrics.cvssMetricV31?.length) {
        severity = metrics.cvssMetricV31[0].cvssData?.baseSeverity ?? 'UNKNOWN';
        score = metrics.cvssMetricV31[0].cvssData?.baseScore ?? 0;
      } else if (metrics.cvssMetricV30?.length) {
        severity = metrics.cvssMetricV30[0].cvssData?.baseSeverity ?? 'UNKNOWN';
        score = metrics.cvssMetricV30[0].cvssData?.baseScore ?? 0;
      }
      if (!['HIGH', 'CRITICAL'].includes(severity)) continue;
      results.push({
        image: imageName,
        cveId: cve.id ?? 'N/A',
        severity,
        score,
        published: cve.published,
        description: (cve.descriptions ?? []).find((d: any) => d.lang === 'en')?.value?.slice(0, 120) ?? '',
      });
    }
    return results;
  } catch {
    return [];
  }
}

function getAdminUserId(): string | null {
  try {
    const db = getDb();
    return db.select({ id: schema.users.id }).from(schema.users).limit(1).get()?.id ?? null;
  } catch {
    return null;
  }
}

export async function runCveScanner(): Promise<void> {
  const userId = getAdminUserId();
  if (!userId) return;

  console.log('[cve-scanner] starting NVD scan...');
  const allCves: CveResult[] = [];

  // Query sequentially to respect NVD rate limits
  for (const image of IMAGES) {
    const results = await queryNvd(image);
    allCves.push(...results);
    await new Promise(r => setTimeout(r, 600)); // NVD rate limit: ~5 req/s
  }

  const criticalCount = allCves.filter(c => c.severity === 'CRITICAL').length;
  const highCount = allCves.filter(c => c.severity === 'HIGH').length;
  const severity = criticalCount > 0 ? 'critical' : highCount > 0 ? 'warning' : 'info';
  const title = `NVD CVE Scan — ${allCves.length} findings (last 30 days)`;
  const detail = allCves.length === 0
    ? 'Clean scan — no HIGH or CRITICAL CVEs found in tracked images.'
    : allCves.slice(0, 5).map(c => `${c.cveId} (${c.severity} ${c.score}) — ${c.image}`).join('\n');

  await fireAlert({ userId, serviceId: null, eventType: 'nvd_cve_scan', severity, title, detail });
  console.log(`[cve-scanner] done — ${allCves.length} CVEs, severity: ${severity}`);
}

let _lastCveRunDate = '';

export function scheduleCveScanner(): void {
  setInterval(async () => {
    const now = new Date();
    const day = now.getUTCDay();    // 0=Sun
    const hour = now.getUTCHours(); // 14 UTC = 8AM CT
    const dateStr = now.toISOString().split('T')[0];
    if (day === 0 && hour === 14 && _lastCveRunDate !== dateStr) {
      _lastCveRunDate = dateStr;
      runCveScanner().catch(err => console.error('[cve-scanner] failed:', err));
    }
  }, 60 * 60 * 1000); // check every hour
}
