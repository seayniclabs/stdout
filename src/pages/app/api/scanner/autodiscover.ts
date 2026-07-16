import type { APIRoute } from 'astro';
import { completeStep, SetupStep } from '../../../../lib/setup';
import http from 'node:http';

export const POST: APIRoute = async ({ request, locals }) => {
  console.log('[autodiscover] API called, locals.user:', locals.user ? 'YES' : 'NO');
  const session = locals.user;
  if (!session) {
    console.log('[autodiscover] No session, returning 401');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log('[autodiscover] Creating SSE stream');
  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      console.log('[autodiscover] Stream started');
      const send = (data: unknown) => {
        console.log('[autodiscover] Sending:', data.type, data.message || '');
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

      try {
        send({ type: 'log', level: 'info', message: 'Initializing scanner...' });
        send({ type: 'progress', percent: 10 });

        // Check if Docker socket is available
        const socketPath = '/var/run/docker.sock';
        send({ type: 'log', level: 'info', message: 'Connecting to Docker API...' });

        try {
          // Call Docker API to list containers
          const containers = await listDockerContainers(socketPath);

          send({ type: 'progress', percent: 60 });
          send({ type: 'log', level: 'success', message: `Found ${containers.length} running container(s)` });

          for (const container of containers) {
            const name = container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
            const status = container.State || 'unknown';
            send({ type: 'log', level: 'info', message: `  • ${name} (${status})` });
          }

          send({ type: 'progress', percent: 90 });
          send({ type: 'log', level: 'success', message: 'Scan complete!' });
          send({ type: 'progress', percent: 100 });

          // Mark scanner step as complete
          await completeStep(SetupStep.Scanner, {
            scannedAt: new Date().toISOString(),
            automated: true,
            containersFound: containers.length,
          });

          send({ type: 'complete' });
        } catch (error: unknown) {
          send({ type: 'log', level: 'error', message: `Docker API error: ${error instanceof Error ? error.message : String(error)}` });
          send({ type: 'log', level: 'info', message: 'You can add infrastructure manually after setup' });
          send({ type: 'progress', percent: 100 });

          // Complete anyway
          await completeStep(SetupStep.Scanner, {
            scannedAt: new Date().toISOString(),
            automated: false,
            error: error instanceof Error ? error.message : String(error),
          });

          send({ type: 'complete' });
        }

        controller.close();

      } catch (error: unknown) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
};

/**
 * List Docker containers using Docker API via Unix socket
 */
async function listDockerContainers(socketPath: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath,
      path: '/containers/json',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const containers = JSON.parse(data);
          resolve(containers);
        } catch (error) {
          reject(new Error('Failed to parse Docker API response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Docker socket connection failed: ${error instanceof Error ? error.message : String(error)}`));
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Docker API request timed out'));
    });

    req.end();
  });
}
