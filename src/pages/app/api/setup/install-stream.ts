/**
 * StdOut Installation Progress Stream
 *
 * Server-Sent Events (SSE) endpoint for real-time installation progress
 * GET /app/api/setup/install-stream
 */

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userId = locals.workspace?.ownerId || locals.user.id;

  // Create SSE response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Import installation modules
      const { InstallWatcher } = await import('../../../../lib/setup/watcher');
      const {
        runDatabaseInit,
        runScannerSetup,
        runWindlassInstall,
        runObservatorySetup,
        runDataSourceDiscovery,
        runMonitorConfiguration,
        runHealthCheck
      } = await import('../../../../lib/setup/installer');

      const watcher = new InstallWatcher();

      // Send initial state
      sendEvent('state', watcher.getState());

      // Subscribe to events
      const unsubscribe = watcher.onEvent((event) => {
        sendEvent('event', event);
        sendEvent('state', watcher.getState());
      });

      // Start installation
      watcher.start();

      try {
        // ==================== STEP 1: Database Initialization ====================
        watcher.startStep('database');

        const dbResult = await runDatabaseInit(userId, (progress, message) => {
          watcher.updateProgress('database', progress, message);
        });

        watcher.completeStep('database', dbResult);

        if (!dbResult.success) {
          throw new Error(`Database initialization failed: ${dbResult.errors[0]}`);
        }

        // ==================== STEP 2: Scanner Setup ====================
        watcher.startStep('scanner');

        const scannerResult = await runScannerSetup(userId, (progress, message) => {
          watcher.updateProgress('scanner', progress, message);
        });

        watcher.completeStep('scanner', scannerResult);

        if (!scannerResult.success) {
          watcher.addWarning('scanner', scannerResult.errors[0] || 'Scanner setup failed');
        }

        // ==================== STEP 3: Windlass Installation ====================
        const skipWindlass = false; // Make this configurable later

        if (skipWindlass) {
          watcher.skipStep('windlass', 'Skipped by user');
        } else {
          watcher.startStep('windlass');

          const windlassResult = await runWindlassInstall((progress, message) => {
            watcher.updateProgress('windlass', progress, message);
          });

          watcher.completeStep('windlass', windlassResult);

          if (!windlassResult.success) {
            watcher.addWarning('windlass', windlassResult.errors[0] || 'Windlass install failed');
          }
        }

        // ==================== STEP 4: Observatory Setup ====================
        const skipObservatory = false; // Make this configurable later

        if (skipObservatory) {
          watcher.skipStep('observatory', 'Skipped by user');
        } else {
          watcher.startStep('observatory');

          const obsResult = await runObservatorySetup((progress, message) => {
            watcher.updateProgress('observatory', progress, message);
          });

          watcher.completeStep('observatory', obsResult);

          if (!obsResult.success) {
            watcher.addWarning('observatory', obsResult.warnings[0] || 'Observatory setup incomplete');
          }
        }

        // ==================== STEP 5: Data Source Discovery ====================
        const skipDataSources = false; // Make this configurable later

        if (skipDataSources) {
          watcher.skipStep('data_sources', 'Skipped by user');
        } else {
          watcher.startStep('data_sources');

          const dataSourceResult = await runDataSourceDiscovery((progress, message) => {
            watcher.updateProgress('data_sources', progress, message);
          });

          watcher.completeStep('data_sources', dataSourceResult);

          if (!dataSourceResult.success) {
            watcher.addWarning('data_sources', dataSourceResult.errors[0] || 'Discovery failed');
          }
        }

        // ==================== STEP 6: Monitor Configuration ====================
        const skipMonitors = false; // Make this configurable later

        if (skipMonitors) {
          watcher.skipStep('monitors', 'Skipped by user');
        } else {
          watcher.startStep('monitors');

          const monitorResult = await runMonitorConfiguration(userId, (progress, message) => {
            watcher.updateProgress('monitors', progress, message);
          });

          watcher.completeStep('monitors', monitorResult);

          if (!monitorResult.success) {
            watcher.addWarning('monitors', monitorResult.errors[0] || 'Configuration failed');
          }
        }

        // ==================== STEP 7: Health Verification ====================
        watcher.startStep('health_check');

        const healthResult = await runHealthCheck((progress, message) => {
          watcher.updateProgress('health_check', progress, message);
        });

        watcher.completeStep('health_check', healthResult);

        // Mark installation as complete in database
        const { getCentralDb } = await import('../../../../lib/db');
        const { sql } = await import('drizzle-orm');
        const db = getCentralDb();

        await db.run(sql`
          INSERT INTO system_state (key, value, updated_at)
          VALUES ('installation_complete', 'true', ${Date.now()})
          ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = ${Date.now()}
        `);

        // Send final state and summary
        sendEvent('complete', {
          state: watcher.getState(),
          summary: watcher.getSummary()
        });

      } catch (error: any) {
        sendEvent('error', { message: error.message });
      } finally {
        unsubscribe();
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
};
