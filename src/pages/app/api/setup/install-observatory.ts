import type { APIRoute } from 'astro';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * POST /app/api/setup/install-observatory
 *
 * Installs Observatory observability stack:
 * 1. Check/install Ollama on host
 * 2. Pull required models (llama3.2:3b, qwen2.5:14b)
 * 3. Start Observatory services with profile
 * 4. Return success/failure
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('[install-observatory] Starting Observatory installation...');

    const isDocker = process.env.STDOUT_MODE === 'selfhost' || fs.existsSync('/.dockerenv');
    const projectRoot = isDocker ? '/app' : process.cwd();
    const dockerComposePath = path.join(projectRoot, 'docker-compose.yml');

    console.log(`[install-observatory] Project root: ${projectRoot}`);

    // Step 1: Check if Ollama is installed on host
    console.log('[install-observatory] Checking for Ollama installation...');
    let ollamaInstalled = false;
    try {
      const { stdout } = await execFileAsync('which', ['ollama']);
      if (stdout.trim()) {
        ollamaInstalled = true;
        console.log('[install-observatory] Ollama found at:', stdout.trim());
      }
    } catch (error) {
      console.log('[install-observatory] Ollama not found on host');
    }

    if (!ollamaInstalled) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Ollama not installed',
        message: 'Observatory requires Ollama to be installed on the host machine. Please install Ollama from https://ollama.ai and try again.',
        installUrl: 'https://ollama.ai/download',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Pull required models (run in background)
    console.log('[install-observatory] Pulling Ollama models (this may take a while)...');
    const models = [
      'llama3.2:3b-instruct-q4_K_M',
      'qwen2.5:14b-instruct-q4_K_M',
    ];

    const modelPullPromises = models.map(async (model) => {
      try {
        console.log(`[install-observatory] Pulling model: ${model}`);
        // Pull model in background - don't wait for completion
        execFile('ollama', ['pull', model], (error, stdout, stderr) => {
          if (error) {
            console.error(`[install-observatory] Failed to pull ${model}:`, error.message);
          } else {
            console.log(`[install-observatory] Successfully pulled ${model}`);
          }
        });
        return { model, status: 'pulling' };
      } catch (error: any) {
        console.error(`[install-observatory] Error pulling ${model}:`, error.message);
        return { model, status: 'failed', error: error.message };
      }
    });

    const modelStatuses = await Promise.all(modelPullPromises);

    // Step 3: Create Observatory config directories
    const observatoryDirs = [
      path.join(projectRoot, 'observatory/config'),
      path.join(projectRoot, 'observatory/data'),
    ];

    for (const dir of observatoryDirs) {
      if (!fs.existsSync(dir)) {
        console.log(`[install-observatory] Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Step 4: Start Observatory services with profile
    console.log('[install-observatory] Starting Observatory services...');

    if (!fs.existsSync(dockerComposePath)) {
      console.error('[install-observatory] docker-compose.yml not found at:', dockerComposePath);
      return new Response(JSON.stringify({
        success: false,
        error: 'docker-compose.yml not found',
        message: 'Could not locate docker-compose.yml.',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Start Observatory services with the observatory profile
      console.log('[install-observatory] Starting Observatory stack (sentinel, prometheus, loki, tempo, pcap)...');
      execFileSync('docker', ['compose', '--profile', 'observatory', 'up', '-d'], {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 120000, // 2 minutes for image pulls
      });

      // Wait a moment for services to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if observatory-sentinel is running
      try {
        const inspectOutput = execFileSync('docker', [
          'inspect',
          '--format={{.State.Running}}',
          'observatory-sentinel'
        ], {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();

        console.log(`[install-observatory] Sentinel running: ${inspectOutput}`);

        if (inspectOutput !== 'true') {
          console.warn('[install-observatory] Observatory services started but sentinel not running yet');
        }
      } catch (err) {
        console.warn('[install-observatory] Could not verify sentinel status:', err);
      }

      console.log('[install-observatory] Observatory installation complete!');
      return new Response(JSON.stringify({
        success: true,
        message: 'Observatory installed and starting',
        services: [
          'observatory-sentinel (AI agents)',
          'prometheus (metrics)',
          'loki (logs)',
          'tempo (traces)',
          'observatory-pcap (network capture)',
        ],
        modelStatuses,
        warning: 'Models are downloading in the background. Observatory will be fully operational once downloads complete (5-10 minutes).',
        sentinelUrl: 'http://localhost:8081',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (execError: any) {
      console.error('[install-observatory] Error starting Observatory services:', execError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to start Observatory services',
        message: execError.message || 'Unknown error',
        details: execError.stderr?.toString() || execError.stdout?.toString() || '',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('[install-observatory] Unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Unexpected error during installation',
      message: error.message || String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
