import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

const execAsync = promisify(exec);

/**
 * Promise timeout helper - rejects if promise doesn't complete within timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  // Auth check - SECURITY FIX: was previously disabled "for setup"
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  const body = await request.json();

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }
  const subnetInput = body.subnet || '192.168.0.0/24';

  // Parse multiple subnets (comma or space separated)
  const subnets = subnetInput
    .split(/[,\s]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

      let streamClosed = false;
      const MAX_SCAN_TIMEOUT = 120000; // 2 minute absolute timeout for entire scan

      // Ensure complete event fires even if scan hangs
      const scanTimeoutHandle = setTimeout(() => {
        if (!streamClosed) {
          console.error('[scan] Scan exceeded max timeout, forcing completion');
          try {
            send({ type: 'log', level: 'error', message: 'Scan timeout: Some targets did not respond in time' });
            send({ type: 'progress', percent: 100 });
            send({ type: 'complete', hosts: [], timedOut: true });
            controller.close();
            streamClosed = true;
          } catch (e) {
            console.error('[scan] Failed to send timeout complete:', e);
          }
        }
      }, MAX_SCAN_TIMEOUT);

      try {
        console.log('[scan] Starting scan for:', subnets);
        send({ type: 'log', level: 'info', message: `Scanning ${subnets.length} network(s): ${subnets.join(', ')}` });
        send({ type: 'progress', percent: 5 });

        let allHosts: Array<{ ip: string; hostname?: string }> = [];

        // Fast ping sweep - scan gateway IPs first for quick results
        console.log('[scan] Starting gateway scan...');
        send({ type: 'log', level: 'info', message: 'Fast gateway scan...' });
        const gatewayHosts: Array<{ ip: string; hostname?: string }> = [];

        // Extract gateway IPs from subnets and scan them first
        for (const subnet of subnets) {
          const [network, cidr] = subnet.split('/');
          const parts = network.split('.');
          const gatewayIP = `${parts[0]}.${parts[1]}.${parts[2]}.1`;

          try {
            // Quick ping test for gateway - per-target 3s timeout
            await withTimeout(
              execAsync(`ping -c 1 -W 1 ${gatewayIP}`, { timeout: 2000 }),
              3000,
              `Gateway ping ${gatewayIP}`
            );
            gatewayHosts.push({ ip: gatewayIP, hostname: 'Gateway' });
            send({ type: 'log', level: 'success', message: `Found gateway: ${gatewayIP}` });
          } catch (e) {
            // Gateway not reachable, skip
            console.log('[scan] Gateway', gatewayIP, 'not reachable:', (e as Error).message);
          }
        }

        send({ type: 'progress', percent: 10 });

        // Scan all subnets in parallel with fast ping sweep
        console.log('[scan] Starting subnet scans for:', subnets.length, 'networks');
        const scanPromises = subnets.map(async (subnet: string, i: number) => {
          const progressBase = 10 + Math.floor((i / subnets.length) * 50);

          console.log('[scan] Scanning subnet:', subnet);
          send({ type: 'log', level: 'info', message: `Scanning ${subnet}...` });
          send({ type: 'progress', percent: progressBase + 5 });

          // Use fast ping sweep - much faster than nmap for host discovery
          // Scan 10 IPs at a time in parallel
          const [network, cidr] = subnet.split('/');
          const parts = network.split('.');
          const baseIP = `${parts[0]}.${parts[1]}.${parts[2]}`;

          const hosts: Array<{ ip: string; hostname?: string }> = [];
          const batchSize = 10; // Scan 10 concurrent pings to avoid overwhelming container

          console.log('[scan] Starting ping sweep for', baseIP + '.0/24');
          for (let start = 1; start <= 254; start += batchSize) {
            const end = Math.min(start + batchSize - 1, 254);
            const pingPromises = [];

            for (let octet = start; octet <= end; octet++) {
              const ip = `${baseIP}.${octet}`;
              // Quick ping: 1 packet, 1 second timeout, with promise timeout safety net
              pingPromises.push(
                withTimeout(
                  execAsync(`ping -c 1 -W 1 ${ip}`, { timeout: 2000 }),
                  3000,
                  `Ping ${ip}`
                )
                  .then(() => ({ ip }))
                  .catch((error) => {
                    // Log timeout errors for debugging but don't crash
                    if (error instanceof Error && error instanceof Error ? error.message : String(error).includes('timed out')) {
                      // Expected timeout, skip this host
                    }
                    return null;
                  })
              );
            }

            // Wait for this batch with overall timeout protection
            try {
              const results = await withTimeout(
                Promise.all(pingPromises),
                batchSize * 3500, // Allow up to 3.5s per IP in batch
                `Batch ${Math.floor(start / batchSize)} for ${subnet}`
              );
              for (const result of results) {
                if (result) hosts.push(result);
              }
            } catch (batchErr) {
              console.error('[scan] Batch timeout for', subnet, ':', batchErr);
              send({ type: 'log', level: 'info', message: `Batch timeout at ${baseIP}.${start}, skipping...` });
              // Continue to next batch instead of failing
            }

            const progress = progressBase + 5 + Math.floor(((start - 1) / 254) * 45);
            send({ type: 'progress', percent: progress });

            // Send keepalive progress updates every 5 batches (50 IPs) to prevent timeout
            if (start % 50 === 1 || start === 1) {
              const pct = Math.floor(((start - 1) / 254) * 100);
              console.log('[scan] Progress:', pct + '% complete for', subnet);
              send({ type: 'log', level: 'info', message: `Scanning ${subnet}: ${pct}% complete (${hosts.length} found so far)` });
            }
          }

          console.log('[scan] Completed scan for', subnet, '- found', hosts.length, 'hosts');
          send({ type: 'log', level: 'success', message: `Found ${hosts.length} host(s) on ${subnet}` });

          for (const host of hosts) {
            send({ type: 'log', level: 'info', message: `  • ${host.ip}` });
          }

          return hosts;
        });

        // Wait for all subnet scans to complete with timeout
        try {
          const hostsArrays = await withTimeout(
            Promise.all(scanPromises),
            110000, // 110 second timeout for all scans (leaves 10s for cleanup)
            'All subnet scans'
          );
          allHosts = hostsArrays.flat();
        } catch (scanErr) {
          console.error('[scan] Subnet scan timeout, using partial results:', scanErr);
          send({ type: 'log', level: 'error', message: 'Scan timeout: returning partial results' });
          // Continue with whatever hosts we've found so far
        }

        send({ type: 'progress', percent: 60 });
        send({ type: 'log', level: 'info', message: `Total: ${allHosts.length} host(s) found across all networks` });

        // Skip service scan for now - too slow for setup wizard
        // Service detection can be done later via background job or manual entry
        console.log('[scan] Skipping service scan - returning hosts without services');
        send({ type: 'log', level: 'info', message: 'Host discovery complete (service scan skipped for speed)' });

        // Return hosts with empty services array
        const hostsWithServices = allHosts.map(h => ({ ...h, services: [] }));

        send({ type: 'progress', percent: 100 });
        send({ type: 'log', level: 'success', message: 'Network scan complete!' });

        // Ensure complete event is sent - critical for frontend to proceed
        console.log('[scan] Sending complete event with', hostsWithServices.length, 'hosts');
        const completeEvent = { type: 'complete', hosts: hostsWithServices };
        send(completeEvent);
        console.log('[scan] Complete event sent successfully');

        // Small delay to ensure event is received before closing stream
        await new Promise(resolve => setTimeout(resolve, 100));
        controller.close();
        streamClosed = true;
        console.log('[scan] Stream closed normally');

      } catch (error: unknown) {
        console.error('[scan] Error during scan:', error);
        if (!streamClosed) {
          send({ type: 'log', level: 'error', message: `Scan error: ${error instanceof Error ? error.message : String(error)}` });
          send({ type: 'progress', percent: 100 });
          send({ type: 'complete', hosts: [], error: error instanceof Error ? error.message : String(error) });
          controller.close();
          streamClosed = true;
        }
      } finally {
        clearTimeout(scanTimeoutHandle);
        if (!streamClosed) {
          try {
            controller.close();
          } catch (e) {
            // Already closed
          }
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    }
  });
};

/**
 * Parse nmap -sn output to extract hosts
 */
function parseNmapOutput(output: string): Array<{ ip: string; hostname?: string }> {
  const hosts: Array<{ ip: string; hostname?: string }> = [];
  const lines = output.split('\n');

  let currentHost: { ip: string; hostname?: string } | null = null;

  for (const line of lines) {
    // "Nmap scan report for hostname (192.168.0.1)" or "Nmap scan report for 192.168.0.1"
    const reportMatch = line.match(/^Nmap scan report for (.+)/);
    if (reportMatch) {
      const target = reportMatch[1];
      const ipMatch = target.match(/\(?([\d.]+)\)?/);
      const hostnameMatch = target.match(/^([^\s(]+)/);

      if (ipMatch) {
        currentHost = {
          ip: ipMatch[1],
          hostname: hostnameMatch && hostnameMatch[1] !== ipMatch[1] ? hostnameMatch[1] : undefined,
        };
      }
    }

    // "Host is up" means the host responded
    if (line.includes('Host is up') && currentHost) {
      hosts.push(currentHost);
      currentHost = null;
    }
  }

  return hosts;
}

/**
 * Scan each host for common services on standard ports
 */
async function scanHostsForServices(
  hosts: Array<{ ip: string; hostname?: string }>,
  send: (data: unknown) => void
): Promise<Array<{ ip: string; hostname?: string; services: Array<{ port: number; service: string; banner?: string }> }>> {
  const COMMON_PORTS = [
    { port: 22, service: 'SSH' },
    { port: 80, service: 'HTTP' },
    { port: 443, service: 'HTTPS' },
    { port: 3000, service: 'Node.js/React Dev' },
    { port: 3306, service: 'MySQL' },
    { port: 5432, service: 'PostgreSQL' },
    { port: 6379, service: 'Redis' },
    { port: 8080, service: 'HTTP Alt' },
    { port: 8081, service: 'HTTP Alt' },
    { port: 8112, service: 'StdOut' },
    { port: 8116, service: 'Windlass' },
    { port: 9000, service: 'Portainer' },
    { port: 5000, service: 'Docker Registry' },
  ];

  const results = [];

  for (const host of hosts) {
    send({ type: 'log', level: 'info', message: `Scanning ${host.ip} for services...` });

    const services = [];

    // Scan common ports using nmap
    const portList = COMMON_PORTS.map(p => p.port).join(',');
    const scanCommand = `nmap -p ${portList} -T4 --max-retries 1 ${host.ip}`;

    try {
      const { stdout } = await execAsync(scanCommand, { timeout: 30000 });

      // Parse open ports
      const openPorts = parseOpenPorts(stdout);

      for (const port of openPorts) {
        const serviceInfo = COMMON_PORTS.find(p => p.port === port);
        if (serviceInfo) {
          services.push(serviceInfo);
        }
      }
    } catch (error) {
      // Scan failed for this host, skip
    }

    results.push({
      ...host,
      services,
    });
  }

  return results;
}

/**
 * Parse nmap port scan output to find open ports
 */
function parseOpenPorts(output: string): number[] {
  const ports: number[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // "22/tcp   open  ssh"
    const match = line.match(/^(\d+)\/tcp\s+open/);
    if (match) {
      ports.push(parseInt(match[1]));
    }
  }

  return ports;
}
