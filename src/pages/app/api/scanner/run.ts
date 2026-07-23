/**
 * POST /app/api/scanner/run
 * Trigger network scanner (quick then detailed scan)
 */

import type { APIRoute } from 'astro';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSqlite } from '../../../../lib/db';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

const execFileAsync = promisify(execFile);

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  try {
    const body = await request.json();

    // CSRF check
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
    }
    const mode = body.mode || 'quick'; // 'quick' or 'detailed'
    const subnets = body.subnets || ['192.168.68.0/24'];

    console.log(`[Scanner] Starting ${mode} scan for subnets: ${subnets.join(', ')}`);

    // Use the scanner image that's already on the host via docker socket
    // The stdout container has access to the host's docker socket
    const scannerArgs = [
      '--scan-network',
      '--subnets', subnets.join(','),
      '--output', 'json',
    ];

    if (mode === 'detailed') {
      // Use --full for all discovery modules (includes DNS, metrics, auth, sources)
      scannerArgs.push('--full');
    }

    // Run via host Docker socket (the stdout container has /var/run/docker.sock mounted)
    const dockerArgs = [
      'run',
      '--rm',
      '--net=host',
      '--cap-add=NET_RAW',
      'ghcr.io/charlieseay/stdout-scanner:latest',
      ...scannerArgs,
    ];

    const { stdout, stderr } = await execFileAsync('docker', dockerArgs, {
      timeout: mode === 'quick' ? 30000 : 120000,
    });

    if (stderr) {
      console.error('[Scanner] stderr:', stderr);
    }

    const results = JSON.parse(stdout);

    // Store network devices in database
    const db = getSqlite();
    let totalDevices = 0;

    // Process network_devices array from scanner output
    if (results.network_devices && Array.isArray(results.network_devices)) {
      for (const subnet of results.network_devices) {
        if (subnet.devices && Array.isArray(subnet.devices)) {
          for (const device of subnet.devices) {
            const appId = `network_${device.ip.replace(/\./g, '_')}`;

            db.prepare(`
              INSERT OR REPLACE INTO discovered_apps
              (id, name, type, host, port, log_source, status, metadata, discovered_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              appId,
              device.hostname || device.ip,
              'network',
              device.ip,
              device.ports?.[0] || null,
              null,
              'discovered',
              JSON.stringify({
                mac: device.mac,
                vendor: device.vendor,
                open_ports: device.ports || [],
                services: device.services || [],
                device_type: device.device_type,
              }),
              Date.now(),
              Date.now()
            );
            totalDevices++;
          }
        }
      }
    }

    console.log(`[Scanner] Stored ${totalDevices} network devices in database`);

    return new Response(JSON.stringify({
      success: true,
      mode,
      discovered: totalDevices,
      devices: results.network_devices || [],
      containers: results.containers || [],
      metrics: results.metrics || {},
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Scanner] Scan failed:', error);

    return new Response(JSON.stringify({
      error: 'Scanner failed',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
