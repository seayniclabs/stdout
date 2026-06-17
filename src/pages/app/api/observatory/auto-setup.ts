import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { createMonitorsFromScan, executeMonitorCreation } from '../../../../lib/observatory/auto-monitor';

/**
 * Observatory Auto-Setup API
 * Analyzes infrastructure and auto-creates monitors
 */

// POST — Analyze and create monitors
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const action = body.action || 'analyze';
  const db = getDb();

  if (action === 'analyze') {
    // Get latest scan data or use provided scan data
    let scanData = body.scanData;

    if (!scanData) {
      // Fetch latest stack import
      const latestImport = db.prepare(`
        SELECT data FROM stack_imports
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(locals.user.id) as any;

      if (!latestImport) {
        return new Response(JSON.stringify({
          error: 'No scan data available. Run scanner first.'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      scanData = JSON.parse(latestImport.data);
    }

    // Get or create default stack
    let stack = db.prepare('SELECT id, name FROM stacks WHERE user_id = ? ORDER BY created_at LIMIT 1')
      .get(locals.user.id) as any;

    if (!stack) {
      const { nanoid } = await import('nanoid');
      const stackId = nanoid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO stacks (id, user_id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        stackId,
        locals.user.id,
        'My Infrastructure',
        'Auto-generated stack from Observatory AI',
        now,
        now
      );

      stack = { id: stackId, name: 'My Infrastructure' };
    }

    // Generate monitor suggestions
    const suggestions = createMonitorsFromScan(db, locals.user.id, scanData, stack.id);

    return new Response(JSON.stringify({
      suggestions,
      stackId: stack.id,
      stackName: stack.name,
      count: suggestions.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (action === 'execute') {
    // Execute monitor creation from suggestions
    const suggestions = body.suggestions;

    if (!suggestions || !Array.isArray(suggestions)) {
      return new Response(JSON.stringify({ error: 'Suggestions array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = executeMonitorCreation(db, locals.user.id, suggestions);

    // Start all created monitors
    if (result.created > 0) {
      const { startMonitor } = await import('../../../../lib/hud');
      const monitors = db.prepare('SELECT id FROM monitors WHERE user_id = ?').all(locals.user.id) as any[];

      for (const monitor of monitors) {
        try {
          startMonitor(locals.user.id, monitor.id);
        } catch (err) {
          // Continue even if one fails to start
        }
      }
    }

    return new Response(JSON.stringify({
      created: result.created,
      errors: result.errors,
      success: result.created > 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
};
