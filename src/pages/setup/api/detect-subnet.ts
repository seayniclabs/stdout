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
      // Inside Docker container: detect the HOST's network via Docker socket
      // The container has /var/run/docker.sock mounted, so we can query the host's bridge
      try {
        // Query Docker's host bridge network to find the host's IP
        const { stdout: dockerOutput } = await execAsync(
          'docker network inspect bridge --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>/dev/null || echo ""'
        );

        const hostGateway = dockerOutput.trim();
        if (hostGateway && hostGateway !== '172.17.0.1') {
          // Found a non-default gateway - extract its network
          const parts = hostGateway.split('.').map(Number);
          if (parts[0] === 192 && parts[1] === 168) {
            subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
          } else if (parts[0] === 10) {
            subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
          }
        }

        // Also check custom network's gateway (stdout-net)
        const { stdout: customOutput } = await execAsync(
          'docker network inspect stdout-net --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>/dev/null || echo ""'
        );

        const customGateway = customOutput.trim();
        if (customGateway && !customGateway.startsWith('10.21.')) {
          const parts = customGateway.split('.').map(Number);
          const networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          if (!subnets.includes(networkSubnet)) {
            subnets.push(networkSubnet);
          }
        }

        // Best approach: inspect the host's network interfaces via Docker exec on host
        // This works because the socket gives us access to the host's Docker daemon
        try {
          const { stdout: hostIp } = await execAsync(
            `docker run --rm --net=host alpine sh -c "ip addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1" 2>/dev/null || echo ""`
          );

          const hostMatch = hostIp.match(/inet ([\d.]+)\/(\d+)/);
          if (hostMatch) {
            const [, ip, cidr] = hostMatch;
            const parts = ip.split('.').map(Number);
            const maskBits = parseInt(cidr);

            // Skip Docker bridges
            if (parts[0] === 172 && parts[1] >= 17 && parts[1] <= 32) {
              // This is a bridge, try next interface
            } else if (maskBits === 24) {
              subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
            } else if (maskBits === 22) {
              const baseOctet = Math.floor(parts[2] / 4) * 4;
              subnets.push(`${parts[0]}.${parts[1]}.${baseOctet}.0/22`);
            } else if (maskBits === 16) {
              subnets.push(`${parts[0]}.${parts[1]}.0.0/16`);
            }
          }
        } catch (hostExecError) {
          console.error('[detect-subnet] Host network check via Docker socket failed:', hostExecError);
        }
      } catch (dockerError) {
        console.error('[detect-subnet] Docker socket query failed:', dockerError);
      }

      // Fallback: scan container's own interfaces (works for host network mode)
      const { stdout } = await execAsync('ip addr show');
      const lines = stdout.split('\n');

      for (const line of lines) {
        const ipMatch = line.match(/inet ([\d.]+)\/(\d+)/);
        if (ipMatch) {
          const [, ip, cidr] = ipMatch;
          const parts = ip.split('.').map(Number);

          // Skip loopback
          if (parts[0] === 127) continue;

          // Skip Docker internal bridge networks (10.21.x, 172.17-32.x)
          if (parts[0] === 10 && parts[1] === 21) continue;
          if (parts[0] === 172 && parts[1] >= 17 && parts[1] <= 32) continue;

          const maskBits = parseInt(cidr);
          let networkSubnet = '';

          if (maskBits === 24) {
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          } else if (maskBits === 22) {
            // /22 network (e.g., 192.168.68.0/22 covers .68-.71)
            const baseOctet = Math.floor(parts[2] / 4) * 4;
            networkSubnet = `${parts[0]}.${parts[1]}.${baseOctet}.0/22`;
          } else if (maskBits === 16) {
            networkSubnet = `${parts[0]}.${parts[1]}.0.0/16`;
          } else if (maskBits === 8) {
            networkSubnet = `${parts[0]}.0.0.0/8`;
          } else {
            // Default to /24 for uncommon masks
            networkSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          }

          if (!subnets.includes(networkSubnet)) {
            subnets.push(networkSubnet);
          }
        }
      }

      // Prioritize most common network patterns for primary subnet
      subnet = subnets.find(s => s.startsWith('192.168.')) ||
               subnets.find(s => s.startsWith('10.')) ||
               subnets.find(s => s.startsWith('172.')) ||
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
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Detection failed',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
