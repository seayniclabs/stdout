import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';

// GET /app/api/incidents/export?id=xxx&format=markdown|json
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const incidentId = url.searchParams.get('id');
  const format = url.searchParams.get('format') || 'markdown';

  const db = getTenantDb(locals.user.id);

  // Single incident export
  if (incidentId) {
    const incident = db.select().from(tenantSchema.incidents)
      .where(and(eq(tenantSchema.incidents.id, incidentId), eq(tenantSchema.incidents.userId, locals.user.id))).get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const resolutions = db.select().from(tenantSchema.resolutions)
      .where(eq(tenantSchema.resolutions.incidentId, incidentId)).all();

    const diagnoses = db.select().from(tenantSchema.diagnoses)
      .where(eq(tenantSchema.diagnoses.incidentId, incidentId)).all();

    // Stack context
    let stackName = '';
    if (incident.stackId) {
      const stack = db.select().from(tenantSchema.stacks)
        .where(eq(tenantSchema.stacks.id, incident.stackId)).get();
      if (stack) stackName = stack.name;
    }

    if (format === 'json') {
      const data = { incident, resolutions, diagnoses, stackName };
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="incident-${incidentId.slice(0, 8)}.json"`,
        },
      });
    }

    // Markdown format
    const md = renderIncidentMarkdown(incident, resolutions, diagnoses, stackName);
    return new Response(md, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="incident-${incidentId.slice(0, 8)}.md"`,
      },
    });
  }

  // Bulk export — all incidents
  const allIncidents = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.userId, locals.user.id)).all();

  if (format === 'json') {
    const data = allIncidents.map(i => {
      const resolutions = db.select().from(tenantSchema.resolutions)
        .where(eq(tenantSchema.resolutions.incidentId, i.id)).all();
      return { ...i, resolutions };
    });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="stdout-incidents-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  }

  // Bulk markdown
  const sections = allIncidents.map(i => {
    const resolutions = db.select().from(tenantSchema.resolutions)
      .where(eq(tenantSchema.resolutions.incidentId, i.id)).all();
    return renderIncidentMarkdown(i, resolutions, [], '');
  });

  return new Response(sections.join('\n\n---\n\n'), {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="stdout-incidents-${new Date().toISOString().split('T')[0]}.md"`,
    },
  });
};

function renderIncidentMarkdown(
  incident: any,
  resolutions: any[],
  diagnoses: any[],
  stackName: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${incident.title}`);
  lines.push('');
  lines.push(`**Severity:** ${incident.severity} | **Status:** ${incident.status}`);
  if (stackName) lines.push(`**Stack:** ${stackName}`);
  if (incident.tags) lines.push(`**Tags:** ${incident.tags}`);
  lines.push(`**Created:** ${incident.createdAt}`);
  if (incident.resolvedAt) lines.push(`**Resolved:** ${incident.resolvedAt}`);
  lines.push('');

  lines.push('## Description');
  lines.push('');
  lines.push(incident.description);
  lines.push('');

  if (resolutions.length > 0) {
    lines.push('## Resolutions');
    lines.push('');
    for (const r of resolutions) {
      lines.push(`### Resolution (${r.createdAt})`);
      lines.push('');
      lines.push(r.content);
      lines.push('');
    }
  }

  if (diagnoses.length > 0) {
    lines.push('## AI Diagnoses');
    lines.push('');
    for (const d of diagnoses) {
      lines.push(`### Diagnosis (${d.model}, ${d.createdAt})`);
      lines.push('');
      try {
        const causes = JSON.parse(d.rootCauses);
        lines.push('**Root Causes:**');
        causes.forEach((c: string, i: number) => lines.push(`${i + 1}. ${c}`));
      } catch {}
      try {
        const cmds = JSON.parse(d.suggestedCommands);
        if (cmds.length > 0) {
          lines.push('');
          lines.push('**Suggested Commands:**');
          lines.push('```');
          cmds.forEach((c: string) => lines.push(c));
          lines.push('```');
        }
      } catch {}
      lines.push('');
    }
  }

  return lines.join('\n');
}
