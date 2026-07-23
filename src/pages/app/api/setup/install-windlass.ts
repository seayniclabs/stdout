import type { APIRoute } from 'astro';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

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
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - service installation requires install_services permission
  const rbacError = checkRBAC(locals, 'install_services');
  if (rbacError) return rbacError;

  // CSRF check
  let body: any = {};
  try { body = await request.json(); } catch (error: unknown) { /* Optional body */ }
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  try {
    console.log('[install-windlass] Starting Windlass installation...');

    // When running in Docker, we need to use the host's compose project
    // The Docker socket is mounted, so we can run docker commands
    // The compose project directory is on the host, not in the container
    const isDocker = process.env.STDOUT_MODE === 'selfhost' || fs.existsSync('/.dockerenv');

    // For config files, use /data mount (mapped to host's ./data directory)
    const windlassConfigDir = '/data/windlass-config';

    console.log(`[install-windlass] Running in Docker: ${isDocker}`);
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

    try {
      // Pull latest windlass image using project name
      // When running in Docker, we're part of the same compose project
      // Use the stdout_default network and project context
      console.log('[install-windlass] Pulling latest Windlass image...');
      const composeProject = 'stdout'; // Project name from docker-compose
      execFileSync('docker', ['pull', 'ghcr.io/seayniclabs/windlass:latest'], {
        stdio: 'pipe',
        timeout: 60000,
      });

      // Start windlass container directly (it's defined in the same docker-compose.yml)
      // Get the compose project name from our own container
      console.log('[install-windlass] Starting Windlass service...');
      const inspectOutput = execFileSync('docker', [
        'inspect',
        '--format={{index .Config.Labels "com.docker.compose.project"}}',
        'stdout'
      ], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      const projectName = inspectOutput || 'stdout';
      console.log(`[install-windlass] Detected compose project: ${projectName}`);

      // Get the network name from the stdout container
      const networkOutput = execFileSync('docker', [
        'inspect',
        '--format={{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}',
        'stdout'
      ], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      // Get the full network name from the ID
      const networkName = execFileSync('docker', [
        'network',
        'inspect',
        '--format={{.Name}}',
        networkOutput
      ], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      console.log(`[install-windlass] Detected network: ${networkName}`);

      // Check if windlass container already exists
      try {
        const existingContainer = execFileSync('docker', [
          'ps',
          '-a',
          '--filter', 'name=^windlass$',
          '--format', '{{.ID}}'
        ], {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();

        if (existingContainer) {
          console.log(`[install-windlass] Found existing container: ${existingContainer}`);
          // Remove the existing container (stopped or running)
          execFileSync('docker', ['rm', '-f', existingContainer], {
            stdio: 'pipe',
            timeout: 10000,
          });
          console.log('[install-windlass] Removed existing container');
        }
      } catch (error) {
        console.log('[install-windlass] No existing container found (or error checking):', error);
      }

      // Start the windlass service in the same compose project
      execFileSync('docker', [
        'run',
        '-d',
        '--name', 'windlass',
        '--network', networkName,
        '--restart', 'unless-stopped',
        '-p', '8116:8116',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', `${windlassConfigDir}:/config`,
        'ghcr.io/seayniclabs/windlass:latest'
      ], {
        stdio: 'pipe',
        timeout: 30000,
      });

      // Step 4: Wait for health check (max 30 seconds)
      console.log('[install-windlass] Waiting for Windlass to become healthy...');
      let healthy = false;
      const maxAttempts = 15;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          // Try healthcheck status first; fall back to running state for images without HEALTHCHECK
          let ready = false;
          try {
            const healthOutput = execFileSync('docker', [
              'inspect',
              '--format={{.State.Health.Status}}',
              'windlass'
            ], { encoding: 'utf8', timeout: 5000 }).trim();
            ready = healthOutput === 'healthy';
          } catch {
            // No healthcheck defined — check if container is simply running
            const stateOutput = execFileSync('docker', [
              'inspect',
              '--format={{.State.Status}}',
              'windlass'
            ], { encoding: 'utf8', timeout: 5000 }).trim();
            ready = stateOutput === 'running';
          }

          console.log(`[install-windlass] Health check attempt ${i + 1}/${maxAttempts}: ready=${ready}`);

          if (ready) {
            healthy = true;
            break;
          }
        } catch (error) {
          console.log(`[install-windlass] Health check attempt ${i + 1}/${maxAttempts} failed:`, error);
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

  } catch (error: unknown) {
    console.error('[install-windlass] Unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Unexpected error during installation',
      message: error instanceof Error ? error.message : String(error) || String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
