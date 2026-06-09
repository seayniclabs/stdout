// Network utilities for subnet detection and CIDR parsing
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Auto-detect local subnets from container's network interfaces
 * Returns an array of CIDR subnets (e.g., ["192.168.1.0/24", "10.0.0.0/24"])
 */
export async function detectLocalSubnets(): Promise<string[]> {
  try {
    // Use `ip addr` to get network interfaces (works in Alpine Linux containers)
    const { stdout } = await execAsync('ip addr show');
    const subnets = parseSubnetsFromIpAddr(stdout);

    if (subnets.length > 0) {
      console.log('[network-utils] Detected subnets:', subnets);
      return subnets;
    }
  } catch (error) {
    console.error('[network-utils] Failed to detect subnets:', error);
  }

  // Fallback to common private ranges if detection fails
  console.log('[network-utils] Using default private ranges');
  return ['192.168.1.0/24', '10.0.0.0/24', '172.16.0.0/24'];
}

/**
 * Parse subnets from `ip addr` output
 */
function parseSubnetsFromIpAddr(output: string): string[] {
  const subnets: string[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Look for "inet <ip>/<prefix>" lines
    const match = line.trim().match(/inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (match) {
      const ip = match[1];
      const prefix = parseInt(match[2]);

      // Skip loopback (127.0.0.0/8)
      if (ip.startsWith('127.')) continue;

      // Skip link-local (169.254.0.0/16)
      if (ip.startsWith('169.254.')) continue;

      // Convert IP + prefix to network address
      const networkAddr = getNetworkAddress(ip, prefix);
      const cidr = `${networkAddr}/${prefix}`;

      if (!subnets.includes(cidr)) {
        subnets.push(cidr);
      }
    }
  }

  return subnets;
}

/**
 * Convert IP + prefix to network address
 * Example: 192.168.1.100/24 → 192.168.1.0
 */
function getNetworkAddress(ip: string, prefix: number): string {
  const parts = ip.split('.').map(Number);
  const mask = ~((1 << (32 - prefix)) - 1);

  const ipInt =
    (parts[0] << 24) |
    (parts[1] << 16) |
    (parts[2] << 8) |
    parts[3];

  const networkInt = (ipInt & mask) >>> 0;

  return [
    (networkInt >>> 24) & 0xFF,
    (networkInt >>> 16) & 0xFF,
    (networkInt >>> 8) & 0xFF,
    networkInt & 0xFF,
  ].join('.');
}

/**
 * Check if IP is in a private range
 */
export function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const first = parts[0];
  const second = parts[1];

  // 10.0.0.0/8
  if (first === 10) return true;

  // 172.16.0.0/12
  if (first === 172 && second >= 16 && second <= 31) return true;

  // 192.168.0.0/16
  if (first === 192 && second === 168) return true;

  return false;
}

/**
 * Expand CIDR notation to list of IPs
 * Example: "192.168.1.0/30" → ["192.168.1.0", "192.168.1.1", "192.168.1.2", "192.168.1.3"]
 * Limits to /24 or larger (max 256 IPs) to avoid memory issues
 */
export function expandCIDR(cidr: string): string[] {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr);

  if (prefix < 24) {
    throw new Error('CIDR prefix must be /24 or larger (max 256 IPs)');
  }

  const parts = network.split('.').map(Number);
  const networkInt =
    (parts[0] << 24) |
    (parts[1] << 16) |
    (parts[2] << 8) |
    parts[3];

  const hostBits = 32 - prefix;
  const numHosts = 1 << hostBits;

  const ips: string[] = [];
  for (let i = 0; i < numHosts; i++) {
    const ipInt = (networkInt + i) >>> 0;
    const ip = [
      (ipInt >>> 24) & 0xFF,
      (ipInt >>> 16) & 0xFF,
      (ipInt >>> 8) & 0xFF,
      ipInt & 0xFF,
    ].join('.');
    ips.push(ip);
  }

  return ips;
}
