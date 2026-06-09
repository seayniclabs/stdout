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
    let subnet: string | null = null;
    const subnets: string[] = [];

    try {
      // Inside Docker container - use default gateway to infer host network
      const { stdout: routeInfo } = await execAsync('ip route show default');
      const defaultMatch = routeInfo.match(/default via ([\d.]+)/);

      if (defaultMatch) {
        const gateway = defaultMatch[1];
        const gatewayParts = gateway.split('.').map(Number);

        // Fast scan: add the gateway's network for quick initial results
        // The gateway is reachable, so we can scan its network
        if (gatewayParts[0] === 10 && gatewayParts[1] === 21) {
          // Docker gateway - probe common home networks
          // Most home networks are 192.168.0.x or 192.168.1.x
          subnets.push('192.168.0.0/24');
          subnets.push('192.168.1.0/24');
        } else if (gatewayParts[0] === 192 && gatewayParts[1] === 168) {
          // Home network gateway - scan its network
          subnets.push(`${gatewayParts[0]}.${gatewayParts[1]}.${gatewayParts[2]}.0/24`);
        } else if (gatewayParts[0] === 10) {
          // Corporate 10.x network
          subnets.push(`${gatewayParts[0]}.${gatewayParts[1]}.${gatewayParts[2]}.0/24`);
        }
      }

      // Also scan container's own networks
      const { stdout } = await execAsync('ip addr show');
      const lines = stdout.split('\n');

      for (const line of lines) {
        const ipMatch = line.match(/inet ([\d.]+)\/(\d+)/);
        if (ipMatch) {
          const [, ip, cidr] = ipMatch;
          const parts = ip.split('.').map(Number);

          // Skip loopback
          if (parts[0] === 127) continue;

          // Skip Docker internal networks (10.21.x, 172.17-32.x)
          if (parts[0] === 10 && parts[1] === 21) continue;
          if (parts[0] === 172 && parts[1] >= 17 && parts[1] <= 32) continue;

          const maskBits = parseInt(cidr);
          let networkSubnet = '';

          if (maskBits === 24) {
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          } else if (maskBits === 16) {
            networkSubnet = `${parts[0]}.${parts[1]}.0.0/16`;
          } else {
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          }

          if (!subnets.includes(networkSubnet)) {
            subnets.push(networkSubnet);
          }
        }
      }

      // Prioritize 192.168.x as default
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
