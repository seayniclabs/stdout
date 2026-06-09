import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const POST: APIRoute = async ({ request, locals }) => {
  // Allow during setup - no auth required
  // const session = locals.user;
  // if (!session) {
  //   return new Response(JSON.stringify({ error: 'Unauthorized' }), {
  //     status: 401,
  //     headers: { 'Content-Type': 'application/json' }
  //   });
  // }

  const body = await request.json();
  const subnetInput = body.subnet || '192.168.0.0/24';

  // Parse multiple subnets (comma or space separated)
  const subnets = subnetInput
    .split(/[,\s]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

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
            // Quick ping test for gateway
            await execAsync(`ping -c 1 -W 1 ${gatewayIP}`, { timeout: 2000 });
            gatewayHosts.push({ ip: gatewayIP, hostname: 'Gateway' });
            send({ type: 'log', level: 'success', message: `Found gateway: ${gatewayIP}` });
          } catch {
            // Gateway not reachable, skip
          }
        }

        send({ type: 'progress', percent: 10 });

        // Scan all subnets in parallel with fast ping sweep
        console.log('[scan] Starting subnet scans for:', subnets.length, 'networks');
        const scanPromises = subnets.map(async (subnet, i) => {
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
          const batchSize = 10; // Reduce to 10 concurrent pings to avoid overwhelming container

          console.log('[scan] Starting ping sweep for', baseIP + '.0/24');
          for (let start = 1; start <= 254; start += batchSize) {
            const end = Math.min(start + batchSize - 1, 254);
            const pingPromises = [];

            for (let octet = start; octet <= end; octet++) {
              const ip = `${baseIP}.${octet}`;
              // Quick ping: 1 packet, 1 second timeout
              pingPromises.push(
                execAsync(`ping -c 1 -W 1 ${ip}`, { timeout: 2000 })
                  .then(() => ({ ip }))
                  .catch(() => null)
              );
            }

            const results = await Promise.all(pingPromises);
            for (const result of results) {
              if (result) hosts.push(result);
            }

            const progress = progressBase + 5 + Math.floor(((start - 1) / 254) * 45);
            send({ type: 'progress', percent: progress });

            // Send keepalive progress updates every 5 batches (50 IPs) to prevent timeout
            if (start % 50 === 1 || start === 1) {
              const pct = Math.floor(((start - 1) / 254) * 100);
              console.log('[scan] Progress:', pct + '% complete for', subnet);
              send({ type: 'log', level: 'info', message: `Scanning ${subnet}: ${pct}% complete` });
            }
          }

          console.log('[scan] Completed scan for', subnet, '- found', hosts.length, 'hosts');
          send({ type: 'log', level: 'success', message: `Found ${hosts.length} host(s) on ${subnet}` });

          for (const host of hosts) {
            send({ type: 'log', level: 'info', message: `  • ${host.ip}` });
          }

          return hosts;
        });

        // Wait for all subnet scans to complete
        const hostsArrays = await Promise.all(scanPromises);
        allHosts = hostsArrays.flat();

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
        console.log('[scan] Stream closed');

      } catch (error: any) {
        console.error('[scan] Error during scan:', error);
        send({ type: 'error', message: error.message });
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
  send: (data: any) => void
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
