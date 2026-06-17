import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';
import { checkCountLimit, tierBlockedResponse } from '../../../../lib/tier-gate';
import { checkRBAC } from '../../../../lib/rbac';
import { requireLicense } from '../../../../lib/license';

const MAX_PAYLOAD_BYTES = 1_048_576; // 1MB

type ScannerDetectedSource = {
  name?: string;
  type?: string;
  endpoint?: string;
  status?: string;
  accessible?: boolean;
};

type ScannerDataSourcesPayload = {
  detected?: ScannerDetectedSource[];
  missing?: Array<{ type?: string; recommendation?: string; reason?: string }>;
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  // License check
  const licenseCheck = requireLicense();
  if (!licenseCheck.valid) {
    return new Response(JSON.stringify({ error: licenseCheck.message }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Tier gate: stack count
  const db = getDb();
  const stackCount = db.select().from(schema.stacks).where(eq(schema.stacks.userId, locals.user.id)).all().length;
  const gate = checkCountLimit(locals.user, 'maxStacks', stackCount, 'Stack');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  // Check payload size
  const contentLength = parseInt(request.headers.get('content-length') || '0');
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ error: 'Payload too large (max 1MB)' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.version || !body.containers || !Array.isArray(body.containers)) {
    return new Response(JSON.stringify({ error: 'Invalid scan format. Required: version, containers[]' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dataSourcesRegistered = syncDetectedDataSources(db, locals.user.id, body.data_sources as ScannerDataSourcesPayload | undefined);

  // Auto-detect data sources from container images
  let autoDetectedSources: Array<{ type: string; name: string; url: string }> = [];
  try {
    const { detectSources } = await import('../../../../lib/source-detect');
    const containerInfos = (body.containers || []).map((c: any) => ({
      name: c.name || '',
      image: c.image || '',
      ports: c.ports || [],
    }));
    const detected = detectSources(containerInfos);

    // Only register sources that don't already exist for this user
    for (const source of detected) {
      const existing = db.select().from(schema.dataSources)
        .where(and(
          eq(schema.dataSources.userId, locals.user.id),
          eq(schema.dataSources.type, source.type),
        ))
        .get();

      if (!existing) {
        db.insert(schema.dataSources).values({
          id: nanoid(),
          userId: locals.user.id,
          name: source.name,
          type: source.type,
          url: source.url,
          token: null,
          username: null,
          password: null,
          org: null,
          bucket: null,
          enabled: true,
          lastTestedAt: null,
          lastTestStatus: 'untested',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run();
        autoDetectedSources.push({ type: source.type, name: source.name, url: source.url });
      }
    }
  } catch {}

  // Render markdown from scan data
  const markdown = renderMarkdown(body);

  const importId = nanoid();

  db.insert(schema.stackImports).values({
    id: importId,
    rawJson: JSON.stringify(body),
    renderedMarkdown: markdown,
    status: 'pending',
    createdAt: new Date(),
  }).run();

  // Log unknown tools from scanner output
  try {
    const { findUnknownTools } = await import('../../../../lib/known-tools');
    const containerNames: string[] = [];
    if (body.containers && Array.isArray(body.containers)) {
      for (const c of body.containers) {
        if (c.image) containerNames.push(c.image);
        if (c.name) containerNames.push(c.name);
      }
    }
    const unknowns = findUnknownTools(containerNames);
    for (const tool of unknowns) {
      // Check for existing entry with a targeted DB query (not .all())
      const existing = db.select()
        .from(schema.unknownTools)
        .where(eq(schema.unknownTools.toolName, tool))
        .get();
      if (!existing) {
        db.insert(schema.unknownTools).values({
          toolName: tool,
          detectedAt: new Date(),
        }).run();
      }
    }
  } catch {}

  return new Response(JSON.stringify({
    importId,
    reviewUrl: `/app/stacks/import/${importId}`,
    dataSourcesRegistered,
    autoDetectedSources,
    /** Full rendered markdown (same as DB) so scanners / QA can verify the review payload without a second fetch. */
    renderedMarkdown: markdown,
    scanSummary: {
      version: body.version,
      containerCount: Array.isArray(body.containers) ? body.containers.length : 0,
      rawJsonChars: JSON.stringify(body).length,
      markdownChars: markdown.length,
    },
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

type ValidDataSourceType = 'influxdb' | 'prometheus' | 'trivy' | 'uptime-kuma' | 'loki' | 'graylog' | 'crowdsec' | 'pihole';

const SCANNER_TYPE_MAP: Record<string, ValidDataSourceType> = {
  prometheus: 'prometheus',
  influxdb: 'influxdb',
  trivy: 'trivy',
  'uptime-kuma': 'uptime-kuma',
  'uptime_kuma': 'uptime-kuma',
  loki: 'loki',
  graylog: 'graylog',
  crowdsec: 'crowdsec',
  pihole: 'pihole',
  'pi-hole': 'pihole',
};

function normalizeDataSourceType(source: ScannerDetectedSource): ValidDataSourceType | null {
  const name = (source.name || '').toLowerCase();
  const type = (source.type || '').toLowerCase();

  // Check direct type mapping
  if (SCANNER_TYPE_MAP[name]) return SCANNER_TYPE_MAP[name];
  if (SCANNER_TYPE_MAP[type]) return SCANNER_TYPE_MAP[type];

  // Legacy fallback for metrics type
  if (type === 'metrics' && name.includes('prometheus')) return 'prometheus';

  return null;
}

function syncDetectedDataSources(db: ReturnType<typeof getTenantDb>, userId: string, dataSources?: ScannerDataSourcesPayload): number {
  const detected = dataSources?.detected;
  if (!detected || !Array.isArray(detected) || detected.length === 0) return 0;

  let upserted = 0;

  for (const source of detected) {
    const normalizedType = normalizeDataSourceType(source);
    const endpoint = (source.endpoint || '').trim();
    const name = (source.name || '').trim();
    if (!normalizedType || !endpoint) continue;

    const existing = db.select().from(schema.dataSources)
      .where(and(
        eq(schema.dataSources.userId, userId),
        eq(schema.dataSources.type, normalizedType),
      ))
      .get();

    const now = new Date();
    const testStatus = source.accessible === false
      ? (source.status || 'unreachable')
      : (source.status || 'ok');

    if (existing) {
      // Preserve user-entered secrets and Influx-specific fields.
      // Update endpoint/health to reflect latest scanner detection.
      db.update(schema.dataSources).set({
        name: existing.name || `${name || 'Prometheus'} (auto-detected)`,
        url: endpoint,
        enabled: true,
        lastTestedAt: now,
        lastTestStatus: testStatus,
        updatedAt: now,
      }).where(and(
        eq(schema.dataSources.id, existing.id),
        eq(schema.dataSources.userId, existing.userId),
      )).run();
    } else {
      // Use tool name for label, not hardcoded "Prometheus"
      const typeLabels: Record<string, string> = {
        prometheus: 'Prometheus', influxdb: 'InfluxDB', trivy: 'Trivy',
        'uptime-kuma': 'Uptime Kuma', loki: 'Loki', graylog: 'Graylog',
        crowdsec: 'CrowdSec', pihole: 'Pi-hole',
      };
      const label = typeLabels[normalizedType] || normalizedType;
      db.insert(schema.dataSources).values({
        id: nanoid(),
        userId,
        name: `${name || label} (auto-detected)`,
        type: normalizedType,
        url: endpoint,
        token: null,
        username: null,
        password: null,
        org: null,
        bucket: null,
        enabled: true,
        lastTestedAt: now,
        lastTestStatus: testStatus,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    upserted += 1;
  }

  return upserted;
}

function renderMarkdown(scan: any): string {
  const lines: string[] = [
    '# Infrastructure Stack',
    `Scanned: ${scan.scanned_at || new Date().toISOString()}`,
    '',
  ];

  if (scan.host) {
    lines.push('## Host');
    if (scan.host.os) lines.push(`- OS: ${scan.host.os} (${scan.host.arch || 'unknown'})`);
    if (scan.host.cpu_cores) lines.push(`- CPU: ${scan.host.cpu_cores} cores`);
    if (scan.host.memory_gb) lines.push(`- RAM: ${scan.host.memory_gb} GB`);
    if (scan.host.disk?.length) {
      for (const d of scan.host.disk) {
        lines.push(`- Disk ${d.mount}: ${d.used_gb}/${d.total_gb} GB used`);
      }
    }
    lines.push('');
  }

  const running = scan.containers.filter((c: any) => c.status === 'running');
  lines.push(`## Containers (${running.length} running)`);
  lines.push('');

  for (const c of scan.containers) {
    lines.push(`### ${c.name} (${c.image || 'unknown'})`);
    if (c.ports?.length) {
      const portStr = c.ports.map((p: any) => `${p.host}:${p.container}`).join(', ');
      lines.push(`- Ports: ${portStr}`);
    }
    if (c.networks?.length) lines.push(`- Networks: ${c.networks.join(', ')}`);
    if (c.health) lines.push(`- Health: ${c.health}`);
    if (c.status) lines.push(`- Status: ${c.status}`);
    lines.push('');
  }

  return lines.join('\n');
}
