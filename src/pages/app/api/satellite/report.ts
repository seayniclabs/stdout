import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { fireAlert } from '../../../../lib/alert-router';
import { sql } from 'drizzle-orm';
import { emit } from '../../../../lib/events';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

interface SatelliteReport {
  node_id: string;
  timestamp: string;
  checks: {
    system?: {
      cpu_percent?: number;
      mem_used_mb?: number;
      mem_total_mb?: number;
      disk_used_gb?: number;
      disk_total_gb?: number;
      load_1?: number;
      load_5?: number;
      load_15?: number;
      uptime_seconds?: number;
    };
    processes?: {
      total?: number;
      failed_units?: string[];
      top_cpu?: Array<{ name: string; pid: number; cpu_pct: number }>;
      top_mem?: Array<{ name: string; pid: number; mem_mb: number }>;
    };
    logs?: {
      error_count_1h?: number;
      warn_count_1h?: number;
      recent_errors?: string[];
    };
    security?: {
      auth_failures_1h?: number;
      root_login_attempts?: number;
      last_sudo?: string;
    };
    docker?: {
      present?: boolean;
      running?: number;
      stopped?: number;
      containers?: Array<{ name: string; status: string; image: string }>;
    };
  };
}

function determineAlertState(report: SatelliteReport): 'ok' | 'warning' | 'critical' {
  const sys = report.checks?.system;
  const proc = report.checks?.processes;
  const sec = report.checks?.security;
  const docker = report.checks?.docker;

  if (sys) {
    const diskPct = sys.disk_total_gb && sys.disk_total_gb > 0
      ? (sys.disk_used_gb ?? 0) / sys.disk_total_gb * 100
      : 0;
    if (diskPct >= 95) return 'critical';
    if (diskPct >= 90) return 'warning';
    if ((sys.cpu_percent ?? 0) >= 85) return 'warning';
  }

  if (proc?.failed_units && proc.failed_units.length > 0) return 'warning';
  if ((sec?.auth_failures_1h ?? 0) >= 10) return 'warning';

  if (docker?.stopped && docker.stopped > 0) return 'warning';

  return 'ok';
}

async function maybeFireAlerts(
  agent: { id: string; name: string; userId: string },
  report: SatelliteReport,
  prevAlertState: string,
  newAlertState: string,
): Promise<void> {
  const sys = report.checks?.system;
  const proc = report.checks?.processes;
  const sec = report.checks?.security;

  if (newAlertState !== prevAlertState) {
    if (newAlertState === 'critical' || newAlertState === 'warning') {
      const details: string[] = [];

      if (sys) {
        const diskPct = sys.disk_total_gb && sys.disk_total_gb > 0
          ? Math.round((sys.disk_used_gb ?? 0) / sys.disk_total_gb * 100)
          : 0;
        if (diskPct >= 90) details.push(`Disk ${diskPct}% full`);
        if ((sys.cpu_percent ?? 0) >= 85) details.push(`CPU at ${sys.cpu_percent}%`);
      }
      if (proc?.failed_units?.length) details.push(`Failed units: ${proc.failed_units.join(', ')}`);
      if ((sec?.auth_failures_1h ?? 0) >= 10) details.push(`${sec!.auth_failures_1h} auth failures in last hour`);

      await fireAlert({
        userId: agent.userId,
        serviceId: null,
        eventType: 'satellite_health',
        severity: newAlertState as 'warning' | 'critical',
        title: `Satellite node ${agent.name} — ${newAlertState}`,
        detail: details.join('; ') || 'Health check thresholds exceeded',
      }).catch(err => console.error(`[satellite/report] fireAlert failed for ${agent.id}:`, err));
    } else if (newAlertState === 'ok' && prevAlertState !== 'ok') {
      await fireAlert({
        userId: agent.userId,
        serviceId: null,
        eventType: 'satellite_recovered',
        severity: 'info',
        title: `Satellite node ${agent.name} recovered`,
        detail: 'All health checks passing.',
      }).catch(err => console.error(`[satellite/report] recovery alert failed for ${agent.id}:`, err));
    }
  }
}

/** POST /app/api/satellite/report — ingest telemetry from a satellite node */
export const POST: APIRoute = async ({ request }) => {
  const rawToken = extractBearerToken(request);
  if (!rawToken) {
    return new Response(JSON.stringify({ error: 'Missing token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const tokenHash = hashToken(rawToken);
  const db = getDb();

  const agent = db.get(sql`
    SELECT id, user_id, name, alert_state FROM satellite_agents WHERE token_hash = ${tokenHash}
  `) as { id: string; user_id: string; name: string; alert_state: string } | undefined;

  if (!agent) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let report: SatelliteReport;
  try {
    report = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!report?.checks) {
    return new Response(JSON.stringify({ error: 'Missing checks field' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const now = Math.floor(Date.now() / 1000);
  const newAlertState = determineAlertState(report);
  const reportId = nanoid();

  // Persist report
  db.run(sql`
    INSERT INTO satellite_reports (id, agent_id, user_id, reported_at, payload, alert_fired)
    VALUES (${reportId}, ${agent.id}, ${agent.user_id}, ${now}, ${JSON.stringify(report)}, ${newAlertState !== 'ok' ? 1 : 0})
  `);

  // Update agent last_seen, last_report summary, alert_state
  const summary = {
    timestamp: report.timestamp,
    system: report.checks.system,
    failedUnits: report.checks.processes?.failed_units ?? [],
    dockerStopped: report.checks.docker?.stopped ?? 0,
    authFailures1h: report.checks.security?.auth_failures_1h ?? 0,
    alertState: newAlertState,
  };

  db.run(sql`
    UPDATE satellite_agents
    SET last_seen = ${now}, last_report = ${JSON.stringify(summary)}, alert_state = ${newAlertState}
    WHERE id = ${agent.id}
  `);

  // Fire alerts if state changed (non-blocking)
  maybeFireAlerts(
    { id: agent.id, name: agent.name, userId: agent.user_id },
    report,
    agent.alert_state,
    newAlertState,
  );

  emit({
    type: 'satellite.report',
    userId: agent.user_id,
    agentId: agent.id,
    alertState: newAlertState as 'ok' | 'warning' | 'critical' | 'stale',
  });

  // Prune reports older than 7 days (async, don't block response)
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
  db.run(sql`DELETE FROM satellite_reports WHERE agent_id = ${agent.id} AND reported_at < ${sevenDaysAgo}`);

  return new Response(JSON.stringify({ ok: true, next_interval: 60 }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
