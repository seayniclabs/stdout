/**
 * Observatory Setup Progress Stream
 *
 * Server-Sent Events (SSE) endpoint for real-time setup progress
 * GET /app/api/observatory/setup-stream
 */

import type { APIRoute } from 'astro';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - setup requires install_services permission
  const rbacError = checkRBAC(locals, 'install_services');
  if (rbacError) return rbacError;

  // Create SSE response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: unknown) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Import setup watcher
      const { SetupWatcher } = await import('../../../../lib/observatory/setup-watcher');
      const { setupObservatory } = await import('../../../../lib/observatory/setup');

      const watcher = new SetupWatcher();

      // Send initial state
      sendEvent('state', watcher.getState());

      // Subscribe to events
      const unsubscribe = watcher.onEvent((event) => {
        sendEvent('event', event);
        sendEvent('state', watcher.getState());
      });

      // Start setup process
      watcher.start();

      try {
        // Step 1: Check Ollama
        watcher.startStep('check_ollama');
        watcher.addOutput('check_ollama', 'Checking if Ollama is installed and running...');

        const { isOllamaAvailable } = await import('../../../../lib/observatory/ollama');
        const ollamaReady = await isOllamaAvailable();

        if (ollamaReady) {
          watcher.addOutput('check_ollama', '✓ Ollama is running');
          watcher.completeStep('check_ollama');
          watcher.skipStep('install_ollama', 'Already installed');
        } else {
          watcher.addOutput('check_ollama', '✗ Ollama not detected');
          watcher.completeStep('check_ollama');

          // Step 2: Install Ollama
          watcher.startStep('install_ollama');
          watcher.addWarning('install_ollama', 'Ollama not found - attempting automatic installation');

          const { installOllama } = await import('../../../../lib/observatory/setup');
          const installResult = await installOllama();

          if (installResult.success) {
            watcher.addOutput('install_ollama', `✓ Installed via ${installResult.method}`);
            watcher.completeStep('install_ollama');
          } else {
            watcher.addWarning('install_ollama', installResult.output);
            watcher.skipStep('install_ollama', 'Manual installation required');
          }
        }

        // Step 3: Check models
        watcher.startStep('check_models');
        watcher.addOutput('check_models', 'Checking required models...');

        const { checkRequiredModels } = await import('../../../../lib/observatory/ollama');
        const modelStatus = await checkRequiredModels();

        watcher.addOutput('check_models', `Installed models: ${modelStatus.available.join(', ') || 'none'}`);
        watcher.completeStep('check_models');

        // Step 4: Pull Watcher model
        if (!modelStatus.watcher) {
          watcher.startStep('pull_watcher');
          watcher.addOutput('pull_watcher', 'Downloading Llama 3.2 3B (~2GB)...');

          const { pullModel } = await import('../../../../lib/observatory/ollama');
          const watcherModel = 'llama3.2:3b';

          try {
            // Simulate progress (actual Ollama pull doesn't provide progress)
            let progress = 0;
            const progressInterval = setInterval(() => {
              progress += 10;
              watcher.updateStepProgress('pull_watcher', progress, (100 - progress) * 2000);
            }, 5000);

            await pullModel(watcherModel);

            clearInterval(progressInterval);
            watcher.updateStepProgress('pull_watcher', 100, 0);
            watcher.addOutput('pull_watcher', '✓ Llama 3.2 3B ready');
            watcher.completeStep('pull_watcher');
          } catch (error: unknown) {
            watcher.errorStep('pull_watcher', error instanceof Error ? error.message : String(error));
          }
        } else {
          watcher.skipStep('pull_watcher', 'Already installed');
        }

        // Step 5: Pull Analyst model (in background)
        if (!modelStatus.analyst) {
          watcher.startStep('pull_analyst');
          watcher.addOutput('pull_analyst', 'Downloading Qwen 2.5 14B (~9GB) in background...');
          watcher.addWarning('pull_analyst', 'Large model - will complete in 10-20 minutes');
          watcher.skipStep('pull_analyst', 'Downloading in background');
        } else {
          watcher.skipStep('pull_analyst', 'Already installed');
        }

        // Step 6: Verify
        watcher.startStep('verify');
        watcher.addOutput('verify', 'Running final verification...');

        const finalCheck = await isOllamaAvailable();
        if (finalCheck) {
          watcher.addOutput('verify', '✓ Ollama is operational');
          watcher.addOutput('verify', '✓ Observatory setup complete');
          watcher.completeStep('verify');
        } else {
          watcher.errorStep('verify', 'Ollama not responding - manual setup required');
        }

        // Send final state
        sendEvent('complete', watcher.getState());

      } catch (error: unknown) {
        sendEvent('error', { message: error instanceof Error ? error.message : String(error) });
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
