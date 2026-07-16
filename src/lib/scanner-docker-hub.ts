/**
 * Docker Hub Update Checker — native StdOut replacement for n8n Ha74yd4fxMiEK5kc
 *
 * Weekly (Monday 13:00 UTC / 7AM CT). Checks Docker Hub for images updated
 * in the last 7 days. Fires a single summary alert via the alert router.
 */

import { fireAlert } from './alert-router';
import { getDb, schema } from './db';

interface DockerImage {
  namespace: string;
  repo: string;
}

const IMAGES: DockerImage[] = [
  { namespace: 'netdata', repo: 'netdata' },
  { namespace: 'linuxserver', repo: 'radarr' },
  { namespace: 'linuxserver', repo: 'sonarr' },
  { namespace: 'linuxserver', repo: 'lidarr' },
  { namespace: 'linuxserver', repo: 'bazarr' },
  { namespace: 'linuxserver', repo: 'prowlarr' },
  { namespace: 'plexinc', repo: 'pms-docker' },
  { namespace: 'jc21', repo: 'nginx-proxy-manager' },
  { namespace: 'ghcr.io/gethomepage', repo: 'homepage' },
  { namespace: 'n8nio', repo: 'n8n' },
  { namespace: 'portainer', repo: 'portainer-ce' },
  { namespace: 'vaultwarden', repo: 'server' },
  { namespace: 'grafana', repo: 'grafana-oss' },
  { namespace: 'miniflux', repo: 'miniflux' },
  { namespace: 'filebrowser', repo: 'filebrowser' },
  { namespace: 'influxdb', repo: 'influxdb' },
  { namespace: 'postgres', repo: 'postgres' },
];

interface UpdatedImage {
  image: string;
  tag: string;
  lastUpdated: string;
}

async function checkImage(img: DockerImage): Promise<UpdatedImage | null> {
  const url = `https://hub.docker.com/v2/repositories/${img.namespace}/${img.repo}/tags/?page_size=1&ordering=last_updated`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const results: unknown[] = data.results ?? [];
    if (!results.length) return null;
    const latest = results[0];
    const lastUpdated = new Date(latest.last_updated);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastUpdated < sevenDaysAgo) return null;
    return { image: `${img.namespace}/${img.repo}`, tag: latest.name, lastUpdated: latest.last_updated };
  } catch {
    return null;
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

export async function runDockerHubScanner(): Promise<void> {
  const userId = getAdminUserId();
  if (!userId) return;

  console.log('[docker-hub-scanner] checking for updates...');
  const updates: UpdatedImage[] = [];

  for (const img of IMAGES) {
    const result = await checkImage(img);
    if (result) updates.push(result);
    await new Promise(r => setTimeout(r, 200));
  }

  const severity = updates.length > 0 ? 'info' : 'info';
  const title = `Docker Hub — ${updates.length} image${updates.length !== 1 ? 's' : ''} updated this week`;
  const detail = updates.length === 0
    ? 'No tracked images updated in the last 7 days.'
    : updates.slice(0, 8).map(u => `${u.image}:${u.tag} (${new Date(u.lastUpdated).toLocaleDateString()})`).join('\n');

  await fireAlert({ userId, serviceId: null, eventType: 'docker_hub_update', severity, title, detail });
  console.log(`[docker-hub-scanner] done — ${updates.length} updates found`);
}

let _lastDockerRunDate = '';

export function scheduleDockerHubScanner(): void {
  setInterval(async () => {
    const now = new Date();
    const day = now.getUTCDay();    // 1=Mon
    const hour = now.getUTCHours(); // 13 UTC = 7AM CT
    const dateStr = now.toISOString().split('T')[0];
    if (day === 1 && hour === 13 && _lastDockerRunDate !== dateStr) {
      _lastDockerRunDate = dateStr;
      runDockerHubScanner().catch(err => console.error('[docker-hub-scanner] failed:', err));
    }
  }, 60 * 60 * 1000);
}
