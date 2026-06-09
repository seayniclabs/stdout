import type { APIRoute } from 'astro';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * POST /app/api/setup/install-windlass
 *
 * Installs and starts Windlass on the same box as StdOut.
 *
 * Steps:
 * 1. Create windlass-config directory if it doesn't exist
 * 2. Generate default config.yml
 * 3. Start windlass container via docker compose
 * 4. Wait for health check
 * 5. Return success/failure
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('[install-windlass] Starting Windlass installation...');

    // Determine project root (where docker-compose.yml lives)
    // In production Docker, we're in /app/dist, project root is /app
    const isDocker = process.env.STDOUT_MODE === 'selfhost' || fs.existsSync('/.dockerenv');
    const projectRoot = isDocker ? '/app' : process.cwd();
    const windlassConfigDir = path.join(projectRoot, 'windlass-config');
    const dockerComposePath = path.join(projectRoot, 'docker-compose.yml');

    console.log(`[install-windlass] Project root: ${projectRoot}`);
    console.log(`[install-windlass] Windlass config dir: ${windlassConfigDir}`);

    // Step 1: Create windlass-config directory
    if (!fs.existsSync(windlassConfigDir)) {
      console.log('[install-windlass] Creating windlass-config directory...');
      fs.mkdirSync(windlassConfigDir, { recursive: true });
    }

    // Step 2: Generate default config.yml
    const configPath = path.join(windlassConfigDir, 'config.yml');
    if (!fs.existsSync(configPath)) {
      console.log('[install-windlass] Creating default config.yml...');
      const defaultConfig = `# Windlass Configuration
# Created during StdOut setup

# Docker connection
docker_socket: /var/run/docker.sock

# API settings
port: 8116
log_level: info

# Health check endpoint
health_check:
  enabled: true
  path: /health

# Default schedule (you can customize this later)
schedules: []
`;
      fs.writeFileSync(configPath, defaultConfig, 'utf8');
    }

    // Step 3: Start windlass container
    console.log('[install-windlass] Starting Windlass container...');

    if (!fs.existsSync(dockerComposePath)) {
      console.error('[install-windlass] docker-compose.yml not found at:', dockerComposePath);
      return new Response(JSON.stringify({
        success: false,
        error: 'docker-compose.yml not found',
        message: 'Could not locate docker-compose.yml. Windlass must be started manually.',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Pull latest windlass image
      console.log('[install-windlass] Pulling latest Windlass image...');
      execFileSync('docker', ['compose', 'pull', 'windlass'], {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 60000,
      });

      // Start windlass container
      console.log('[install-windlass] Starting Windlass service...');
      execFileSync('docker', ['compose', 'up', '-d', 'windlass'], {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 30000,
      });

      // Step 4: Wait for health check (max 30 seconds)
      console.log('[install-windlass] Waiting for Windlass to become healthy...');
      let healthy = false;
      const maxAttempts = 15;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          const healthOutput = execFileSync('docker', [
            'inspect',
            '--format={{.State.Health.Status}}',
            'windlass'
          ], {
            encoding: 'utf8',
            timeout: 5000,
          }).trim();

          console.log(`[install-windlass] Health check attempt ${i + 1}/${maxAttempts}: ${healthOutput}`);

          if (healthOutput === 'healthy') {
            healthy = true;
            break;
          }
        } catch (err) {
          console.log(`[install-windlass] Health check attempt ${i + 1}/${maxAttempts} failed:`, err);
        }

        // Wait 2 seconds before next attempt
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      if (!healthy) {
        console.warn('[install-windlass] Windlass started but health check not passing yet');
        return new Response(JSON.stringify({
          success: true,
          warning: 'Windlass started but health check not yet passing. It may need a few more seconds.',
          url: 'http://localhost:8116',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log('[install-windlass] Windlass installation complete and healthy!');
      return new Response(JSON.stringify({
        success: true,
        message: 'Windlass installed and running successfully',
        url: 'http://localhost:8116',
        configPath: windlassConfigDir,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (execError: any) {
      console.error('[install-windlass] Error executing docker compose:', execError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to start Windlass container',
        message: execError.message || 'Unknown error',
        details: execError.stderr?.toString() || execError.stdout?.toString() || '',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('[install-windlass] Unexpected error:', error);
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
