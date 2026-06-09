import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const GET: APIRoute = async ({ locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Detect network subnet using ip/ifconfig commands
    let subnet: string | null = null;

    try {
      // Try Linux/modern systems first (ip command)
      const { stdout } = await execAsync('ip route | grep default');
      const match = stdout.match(/default via ([\d.]+) dev (\w+)/);

      if (match) {
        const [, gateway, interface_] = match;
        // Get the IP address for this interface
        const { stdout: ifaceInfo } = await execAsync(`ip addr show ${interface_}`);
        const ipMatch = ifaceInfo.match(/inet ([\d.]+)\/(\d+)/);

        if (ipMatch) {
          const [, ip, cidr] = ipMatch;
          // Calculate network address from IP and CIDR
          const parts = ip.split('.').map(Number);
          const maskBits = parseInt(cidr);

          // For /24 networks (most common), just use first 3 octets
          if (maskBits === 24) {
            subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          } else if (maskBits === 16) {
            subnet = `${parts[0]}.${parts[1]}.0.0/16`;
          } else {
            // Default to /24
            subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          }
        }
      }
    } catch (ipError) {
      // Fallback to ifconfig for macOS/BSD systems
      try {
        const { stdout } = await execAsync('ifconfig | grep "inet "');
        const lines = stdout.split('\n');

        for (const line of lines) {
          const match = line.match(/inet ([\d.]+) netmask 0x([0-9a-f]+)/);
          if (match) {
            const [, ip] = match;
            const parts = ip.split('.');

            // Skip loopback
            if (parts[0] === '127') continue;

            // Assume /24 for private networks
            if (parts[0] === '192' && parts[1] === '168') {
              subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
              break;
            } else if (parts[0] === '10') {
              subnet = `10.0.0.0/24`;
              break;
            } else if (parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) {
              subnet = `172.${parts[1]}.0.0/16`;
              break;
            }
          }
        }
      } catch (ifconfigError) {
        console.error('[detect-subnet] Both ip and ifconfig failed:', ifconfigError);
      }
    }

    return new Response(
      JSON.stringify({
        subnet,
        detected: !!subnet,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[detect-subnet] Error:', error);
    return new Response(
      JSON.stringify({
        subnet: null,
        detected: false,
        error: error instanceof Error ? error.message : 'Detection failed',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
