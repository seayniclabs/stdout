import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const GET: APIRoute = async ({ locals }) => {
  // Allow during setup - no auth required
  // const session = locals.user;
  // if (!session) {
  //   return new Response(JSON.stringify({ error: 'Unauthorized' }), {
  //     status: 401,
  //     headers: { 'Content-Type': 'application/json' },
  //   });
  // }

  try {
    // Detect network subnet using ip/ifconfig commands
    let subnet: string | null = null;

    try {
      // Get all network interfaces and prefer 192.168.x over 10.x (Docker bridge)
      const { stdout } = await execAsync('ip addr show');
      const lines = stdout.split('\n');

      const subnets: string[] = [];

      for (const line of lines) {
        const ipMatch = line.match(/inet ([\d.]+)\/(\d+)/);
        if (ipMatch) {
          const [, ip, cidr] = ipMatch;
          const parts = ip.split('.').map(Number);

          // Skip loopback
          if (parts[0] === 127) continue;

          // Calculate network address
          let networkSubnet = '';
          const maskBits = parseInt(cidr);

          if (maskBits === 24) {
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          } else if (maskBits === 16) {
            networkSubnet = `${parts[0]}.${parts[1]}.0.0/16`;
          } else {
            // Default to /24
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          }

          subnets.push(networkSubnet);
        }
      }

      // Return all detected subnets (will be used for multi-subnet scanning)
      // For now, prioritize 192.168.x as the default, but return all
      subnet = subnets.find(s => s.startsWith('192.168.')) ||
               subnets.find(s => s.startsWith('10.')) ||
               subnets[0] || null;

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

    // Return all unique subnets found
    const allSubnets = [...new Set(subnets)];

    return new Response(
      JSON.stringify({
        subnet, // Primary subnet (for backward compat)
        subnets: allSubnets, // All detected subnets
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
