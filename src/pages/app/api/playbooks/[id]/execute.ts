/**
 * Execute Playbook Endpoint
 * POST /api/playbooks/:id/execute
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../../lib/db';
import { executePlaybook } from '../../../../../lib/remediation/executor';
import { getBuiltInPlaybooks } from '../../../../../lib/remediation/playbooks';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const userId = (request as any).userId;
    const playbookId = params.id;

    if (!userId || !playbookId) {
      return new Response(JSON.stringify({ error: 'Unauthorized or missing playbook ID' }), { status: 401 });
    }

    const body = await request.json() as any;
    const { incidentId, dryRun = false, approve = false } = body;

    if (!incidentId) {
      return new Response(JSON.stringify({ error: 'Missing incidentId' }), { status: 400 });
    }

    const db = getDb();

    // Fetch playbook
    let playbook = db.select()
      .from(schema.remediationPlaybooks)
      .where(eq(schema.remediationPlaybooks.id, playbookId))
      .get();

    // Check built-in playbooks if not found
    if (!playbook) {
      const builtIn = getBuiltInPlaybooks().find((p) => p.id === playbookId);
      if (!builtIn) {
        return new Response(JSON.stringify({ error: 'Playbook not found' }), { status: 404 });
      }
      playbook = builtIn as any;
    } else {
      // Parse JSON fields
      playbook = {
        ...playbook,
        trigger: JSON.parse(playbook.trigger as string),
        steps: JSON.parse(playbook.steps as string),
        rollback: JSON.parse(playbook.rollback as string),
        tags: JSON.parse(playbook.tags as string),
      } as any;
    }

    // Verify incident exists
    const incident = db.select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, incidentId))
      .get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), { status: 404 });
    }

    // Check if approval is required
    if (playbook.requiresApproval && !approve) {
      return new Response(JSON.stringify({
        error: 'Approval required',
        requiresApproval: true,
        message: 'This playbook requires approval before execution',
      }), { status: 403 });
    }

    // Execute the playbook
    const execution = await executePlaybook(playbook, incidentId, userId, dryRun);

    // Save execution to database
    const executionData = {
      id: execution.id,
      playbookId,
      incidentId,
      userId,
      status: execution.status,
      dryRun: dryRun ? 1 : 0,
      approvedBy: approve ? userId : null,
      approvedAt: approve ? new Date() : null,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      logs: JSON.stringify(execution.logs),
      rollbackAttempted: execution.rollbackAttempted ? 1 : 0,
      rollbackSuccess: execution.rollbackSuccess ? 1 : 0,
    };

    db.insert(schema.remediationExecutions).values(executionData).run();

    // Save individual step results
    for (const log of execution.logs) {
      if (log.stepId !== 'system') {
        db.insert(schema.remediationExecutionSteps).values({
          id: nanoid(),
          executionId: execution.id,
          stepId: log.stepId,
          status: log.level === 'error' ? 'failed' : 'success',
          output: log.message,
          errorMessage: log.level === 'error' ? log.message : null,
          durationMs: 0, // Would need to track per step
          retriesUsed: 0,
          executedAt: log.timestamp,
        }).run();
      }
    }

    return new Response(JSON.stringify({
      execution: {
        id: execution.id,
        status: execution.status,
        dryRun,
        logs: execution.logs,
        rollbackAttempted: execution.rollbackAttempted,
        rollbackSuccess: execution.rollbackSuccess,
      },
    }), { status: 200 });
  } catch (error) {
    console.error('Error executing playbook:', error);
    return new Response(JSON.stringify({
      error: 'Failed to execute playbook',
      details: error instanceof Error ? error.message : String(error),
    }), { status: 500 });
  }
};
