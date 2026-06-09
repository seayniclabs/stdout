import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await request.json();
  const subnet = body.subnet || '192.168.0.0/24';

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

      try {
        send({ type: 'log', level: 'info', message: `Scanning network ${subnet}...` });
        send({ type: 'progress', percent: 10 });

        // Use nmap for network discovery
        // -sn: Ping scan (no port scan)
        // -T4: Faster timing
        // --max-retries 1: Faster scan
        const nmapCommand = `nmap -sn -T4 --max-retries 1 ${subnet}`;

        send({ type: 'log', level: 'info', message: 'Running nmap scan...' });

        try {
          const { stdout, stderr } = await execAsync(nmapCommand, {
            timeout: 120000, // 2 minute timeout
          });

          send({ type: 'progress', percent: 60 });

          // Parse nmap output
          const hosts = parseNmapOutput(stdout);

          send({ type: 'log', level: 'success', message: `Found ${hosts.length} host(s)` });

          for (const host of hosts) {
            send({ type: 'log', level: 'info', message: `  • ${host.ip}${host.hostname ? ` (${host.hostname})` : ''}` });
          }

          send({ type: 'progress', percent: 90 });

          // Now scan each host for common services
          send({ type: 'log', level: 'info', message: 'Scanning for common services...' });

          const hostsWithServices = await scanHostsForServices(hosts, send);

          send({ type: 'progress', percent: 100 });
          send({ type: 'log', level: 'success', message: 'Network scan complete!' });
          send({ type: 'complete', hosts: hostsWithServices });

        } catch (error: any) {
          if (error.code === 'ENOENT') {
            send({ type: 'log', level: 'error', message: 'nmap is not installed on this system' });
            send({ type: 'log', level: 'info', message: 'Install nmap: brew install nmap (macOS) or apt-get install nmap (Ubuntu)' });
          } else {
            send({ type: 'log', level: 'error', message: `Scan error: ${error.message}` });
          }
          send({ type: 'progress', percent: 100 });
          send({ type: 'complete', hosts: [] });
        }

        controller.close();

      } catch (error: any) {
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
