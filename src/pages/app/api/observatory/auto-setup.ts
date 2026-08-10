import type { APIRoute } from 'astro';
import { getSqlite } from '../../../../lib/db';
import { createMonitorsFromScan, executeMonitorCreation } from '../../../../lib/observatory/auto-monitor';
import { requireAuth } from '../../../../lib/rbac';

/**
 * Observatory Auto-Setup API
 * Analyzes infrastructure and auto-creates monitors
 */

// POST — Analyze and create monitors
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

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

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const action = body.action || 'analyze';
  const db = getSqlite();

  if (action === 'analyze') {
    // Get latest scan data or use provided scan data
    let scanData = body.scanData;

    if (!scanData) {
      // Fetch latest stack import
      const latestImport = db.prepare(`
        SELECT imported_data FROM stack_imports
        ORDER BY created_at DESC
        LIMIT 1
      `).get() as any;

      if (!latestImport) {
        // No scan data exists - trigger automatic Docker scan
        try {
          const { scanLocalDocker } = await import('../../../../lib/scanner/docker-local');
          console.log('[auto-setup] No scan data found - running automatic Docker scan...');

          scanData = await scanLocalDocker();

          // Import the scan data immediately
          const { nanoid } = await import('nanoid');
          const importId = nanoid();
          const now = new Date().toISOString();

          db.prepare(`
            INSERT INTO stack_imports (id, source, stack_id, imported_data, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            importId,
            'docker',
            null,
            JSON.stringify(scanData),
            'pending',
            now
          );

          console.log(`[auto-setup] Auto-scan complete - found ${scanData.containers?.length || 0} containers`);
        } catch (scanError: any) {
          console.error('[auto-setup] Auto-scan failed:', scanError.message);
          return new Response(JSON.stringify({
            error: 'No scan data available and auto-scan failed. Is Docker accessible?'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } else {
        scanData = JSON.parse(latestImport.imported_data);
      }
    }

    // Get or create default stack
    let stack = db.prepare('SELECT id, name FROM stacks ORDER BY created_at LIMIT 1')
      .get() as any;

    if (!stack) {
      const { nanoid } = await import('nanoid');
      const stackId = nanoid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO stacks (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        stackId,
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

    // Also sync monitors for all discovered hosts
    const { syncHostMonitors } = await import('../../../../lib/observatory/sync-host-monitors');
    console.log('[auto-setup] Syncing host monitors...');
    const hostResult = syncHostMonitors(db, locals.user.id);
    console.log(`[auto-setup] Host monitors: ${hostResult.created} created, ${hostResult.updated} updated`);

    const totalCreated = result.created + hostResult.created;
    const totalUpdated = result.updated + hostResult.updated;

    // Start all created monitors
    if (totalCreated > 0) {
      const { startMonitor } = await import('../../../../lib/hud');
      const monitors = db.prepare('SELECT id FROM monitors').all() as any[];

      for (const monitor of monitors) {
        try {
          startMonitor(locals.user.id, monitor.id);
        } catch (err) {
          // Continue even if one fails to start
        }
      }
    }

    return new Response(JSON.stringify({
      created: totalCreated,
      updated: totalUpdated,
      errors: result.errors,
      success: totalCreated > 0 || totalUpdated > 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
};
