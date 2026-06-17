/**
 * Shodan Security Scanner — native StdOut replacement for n8n dMUAUBIc1mO9Q76k
 *
 * Weekly (Saturday 15:00 UTC / 9AM CT). Gets the lab's public IP via ipify,
 * queries Shodan InternetDB for open ports and known vulnerabilities,
 * fires an alert via the Windlass alert router.
 */

import { fireAlert } from './alert-router';
import { getDb, schema } from './db';

// Ports expected to be publicly visible (Cloudflare Tunnel only, no raw exposure)
const EXPECTED_PORTS = new Set<number>([80, 443]);

function getAdminUserId(): string | null {
  try {
    const db = getDb();
    return db.select({ id: schema.users.id }).from(schema.users).limit(1).get()?.id ?? null;
  } catch {
    return null;
  }
}

async function getPublicIp(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) });
  const data = await res.json() as { ip: string };
  return data.ip;
}

export async function runShodanScanner(): Promise<void> {
  const userId = getAdminUserId();
  if (!userId) return;

  console.log('[shodan-scanner] checking public exposure...');

  let publicIp: string;
  try {
    publicIp = await getPublicIp();
  } catch {
    console.error('[shodan-scanner] failed to get public IP');
    return;
  }

  let shodanData: any;
  try {
    const res = await fetch(`https://internetdb.shodan.io/${publicIp}`, { signal: AbortSignal.timeout(15000) });
    if (res.status === 404) {
      await fireAlert({
        userId, serviceId: null, eventType: 'shodan_scan', severity: 'info',
        title: 'Shodan Security Scan — IP not in database',
        detail: `Public IP ${publicIp} not indexed by Shodan — no public exposure detected.`,
      });
      return;
    }
    shodanData = await res.json();
  } catch {
    console.error('[shodan-scanner] Shodan API request failed');
    return;
  }

  const openPorts: number[] = shodanData.ports ?? [];
  const vulns: string[] = shodanData.vulns ?? [];
  const hostnames: string[] = shodanData.hostnames ?? [];
  const unexpectedPorts = openPorts.filter(p => !EXPECTED_PORTS.has(p));

  const hasIssues = unexpectedPorts.length > 0 || vulns.length > 0;
  const severity = vulns.length > 0 ? 'critical' : unexpectedPorts.length > 0 ? 'warning' : 'info';
  const title = hasIssues
    ? `Shodan Security Scan — ${unexpectedPorts.length} unexpected port(s), ${vulns.length} CVE(s)`
    : 'Shodan Security Scan — clean';
  const lines: string[] = [`IP: ${publicIp}`];
  if (openPorts.length) lines.push(`Open ports: ${openPorts.join(', ')}`);
  if (unexpectedPorts.length) lines.push(`Unexpected: ${unexpectedPorts.join(', ')}`);
  if (vulns.length) lines.push(`CVEs: ${vulns.slice(0, 5).join(', ')}`);
  if (hostnames.length) lines.push(`Hostnames: ${hostnames.slice(0, 3).join(', ')}`);

  await fireAlert({
    userId, serviceId: null, eventType: 'shodan_scan', severity,
    title,
    detail: lines.join('\n'),
  });
  console.log(`[shodan-scanner] done — severity: ${severity}, ports: ${openPorts.length}, vulns: ${vulns.length}`);
}

let _lastShodanRunDate = '';

export function scheduleShodanScanner(): void {
  setInterval(async () => {
    const now = new Date();
    const day = now.getUTCDay();    // 6=Sat
    const hour = now.getUTCHours(); // 15 UTC = 9AM CT
    const dateStr = now.toISOString().split('T')[0];
    if (day === 6 && hour === 15 && _lastShodanRunDate !== dateStr) {
      _lastShodanRunDate = dateStr;
      runShodanScanner().catch(err => console.error('[shodan-scanner] failed:', err));
    }
  }, 60 * 60 * 1000);
}
