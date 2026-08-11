/**
 * Service Heartbeat — native StdOut replacement for n8n EeLmqQtOvS0FKD1g
 *
 * Pings every service every 15 minutes. Flap suppression: 2 consecutive
 * failures before alerting. Fires alerts via the Windlass alert router.
 */

import { fireAlert } from './alert-router';
import { getDb, schema } from './db';
import { emit } from './events';

interface HeartbeatTarget {
  name: string;
  internal: string | null;
  external: string | null;
  critical: boolean;
}

const TARGETS: HeartbeatTarget[] = [
  { name: 'Homepage', internal: 'http://host.docker.internal:8888', external: null, critical: true },
  { name: 'Nginx Proxy Manager', internal: 'http://host.docker.internal:81', external: null, critical: true },
  { name: 'Orchestr8 (n8n)', internal: 'http://host.docker.internal:5678/healthz', external: null, critical: true },
  { name: 'Authentik', internal: 'http://host.docker.internal:9010', external: null, critical: true },
  { name: 'Portainer', internal: 'https://host.docker.internal:9443', external: null, critical: true },
  { name: 'Hone', internal: 'http://host.docker.internal:8101', external: null, critical: true },
  { name: 'charlieseay.com', internal: 'http://host.docker.internal:8100', external: null, critical: false },
  { name: 'Enchapter API', internal: 'http://host.docker.internal:3500/health', external: null, critical: true },
  { name: 'StdOut', internal: 'http://host.docker.internal:8112', external: null, critical: true },
  { name: 'SeaynicLabs Store', internal: 'http://host.docker.internal:8113', external: null, critical: true },
  { name: 'REACT Pro', internal: 'http://host.docker.internal:8104', external: null, critical: false },
  { name: 'Miniflux', internal: 'http://host.docker.internal:8107', external: null, critical: false },
  { name: 'Vaultwarden', internal: 'http://host.docker.internal:8222', external: null, critical: true },
  { name: 'Grafana', internal: 'http://host.docker.internal:3000', external: null, critical: false },
  { name: 'FileBrowser', internal: 'http://host.docker.internal:8102', external: null, critical: false },
  { name: 'Plex', internal: 'http://host.docker.internal:32400/web', external: null, critical: false },
  { name: 'Wallos', internal: 'http://host.docker.internal:8282', external: null, critical: false },
  { name: 'Postiz', internal: 'http://host.docker.internal:5100', external: null, critical: false },
  { name: 'Vault MCP', internal: 'http://host.docker.internal:8108/health', external: null, critical: false },
];

// Excluded services — intentionally stopped/managed by Windlass schedule
const EXCLUDED = new Set(['Postiz']);

interface FlightState {
  failCount: number;
  alerted: boolean;
}
const state = new Map<string, FlightState>();

function key(name: string, side: 'internal' | 'external'): string {
  return `${name}:${side}`;
}

async function pingUrl(url: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      // Allow self-signed certs for internal HTTPS (Portainer uses self-signed)
    });
    return res.status < 500 ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

function getAdminUserId(): string | null {
  try {
    const db = getDb();
    const row = db.select({ id: schema.users.id })
      .from(schema.users)
      .limit(1)
      .get();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function runHeartbeat(): Promise<void> {
  const userId = getAdminUserId();
  if (!userId) {
    console.warn('[heartbeat] No users found, skipping');
    return;
  }

  const THRESHOLD = 2;
  const checks = await Promise.all(
    TARGETS.map(async (svc) => {
      const internal = svc.internal ? await pingUrl(svc.internal) : 'skip';
      return { svc, internal };
    }),
  );

  for (const { svc, internal } of checks) {
    if (EXCLUDED.has(svc.name)) continue;

    const k = key(svc.name, 'internal');
    if (!state.has(k)) state.set(k, { failCount: 0, alerted: false });
    const s = state.get(k)!;

    if (internal === 'down') {
      s.failCount++;
      if (s.failCount >= THRESHOLD && !s.alerted) {
        s.alerted = true;
        await fireAlert({
          userId,
          serviceId: null,
          eventType: 'service_down',
          severity: svc.critical ? 'critical' : 'warning',
          title: `${svc.name} is unreachable`,
          detail: `Internal endpoint ${svc.internal} returned no response after ${s.failCount} consecutive checks.`,
        }).catch(err => console.error(`[heartbeat] fireAlert failed for ${svc.name}:`, err));
      }
    } else if (internal === 'up') {
      if (s.alerted) {
        await fireAlert({
          userId,
          serviceId: null,
          eventType: 'service_up',
          severity: 'info',
          title: `${svc.name} recovered`,
          detail: `Internal endpoint ${svc.internal} is responding again.`,
        }).catch(err => console.error(`[heartbeat] recovery alert failed for ${svc.name}:`, err));
      }
      s.failCount = 0;
      s.alerted = false;
    }
  }
}

async function checkStaleSatellites(): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const warningThreshold = now - 5 * 60;    // 5 min
  const criticalThreshold = now - 15 * 60;  // 15 min

  const agents = db.all(
    // @ts-ignore — raw sql on satellite_agents
    `SELECT id, name, last_seen, alert_state FROM satellite_agents WHERE last_seen IS NOT NULL`
  ) as Array<{ id: string; name: string; last_seen: number; alert_state: string }>;

  for (const agent of agents) {
    const isStale = agent.last_seen < warningThreshold;
    const isCritical = agent.last_seen < criticalThreshold;
    if (!isStale) continue;

    const newState = isCritical ? 'critical' : 'stale';
    if (agent.alert_state === newState) continue; // already alerted

    // @ts-ignore
    db.run(`UPDATE satellite_agents SET alert_state = ? WHERE id = ?`, [newState, agent.id]);

    await fireAlert({
      serviceId: null,
      eventType: 'satellite_stale',
      severity: isCritical ? 'critical' : 'warning',
      title: `Satellite node ${agent.name} stopped reporting`,
      detail: `No report received in ${Math.round((now - agent.last_seen) / 60)} minutes.`,
    }).catch(err => console.error(`[heartbeat] stale satellite alert failed for ${agent.id}:`, err));

    emit({
      type: 'satellite.stale',
      agentId: agent.id,
      name: agent.name,
      silentMinutes: Math.round((now - agent.last_seen) / 60),
    });
  }
}

let _heartbeatStarted = false;

export function startHeartbeat(): void {
  if (_heartbeatStarted) return;
  _heartbeatStarted = true;

  // Initial check after 2 min (let container settle at startup)
  setTimeout(() => {
    runHeartbeat().catch(err => console.error('[heartbeat] run failed:', err));
    checkStaleSatellites().catch(err => console.error('[heartbeat] stale satellite check failed:', err));
    setInterval(() => {
      runHeartbeat().catch(err => console.error('[heartbeat] run failed:', err));
      checkStaleSatellites().catch(err => console.error('[heartbeat] stale satellite check failed:', err));
    }, 15 * 60 * 1000);
  }, 2 * 60 * 1000);

  console.log('[heartbeat] scheduled — 15 min interval, first check in 2 min');
}
