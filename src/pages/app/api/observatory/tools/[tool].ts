import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Observatory Tools API
 * Proxy endpoint for network analysis tools (tcpdump, nmap, dig, ping, traceroute)
 */

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  const tool = params.tool;
  if (!tool) {
    return new Response(JSON.stringify({ error: 'Tool not specified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let output = '';

    switch (tool) {
      case 'pcap':
        output = await runPacketCapture(body);
        break;
      case 'portscan':
        output = await runPortScan(body);
        break;
      case 'dns':
        output = await runDnsLookup(body);
        break;
      case 'ping':
        output = await runPing(body);
        break;
      case 'traceroute':
        output = await runTraceroute(body);
        break;
      case 'discovery':
        output = await runNetworkDiscovery(body);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown tool: ${tool}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({
      success: true,
      tool,
      output,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * Packet capture using tcpdump
 */
async function runPacketCapture(params: any): Promise<string> {
  const { interface: iface = 'any', filter = '', duration = 30 } = params;

  // Safety: limit duration
  const safeDuration = Math.min(Math.max(duration, 5), 300);

  // Build command
  const filterArg = filter ? `-f "${filter.replace(/"/g, '\\"')}"` : '';
  const command = `timeout ${safeDuration} tcpdump -i ${iface} ${filterArg} -c 100 2>&1 || true`;

  const { stdout, stderr } = await execAsync(command, { timeout: (safeDuration + 5) * 1000 });

  return stdout + stderr;
}

/**
 * Port scan using nmap
 */
async function runPortScan(params: any): Promise<string> {
  const { target, ports = '1-1000', scanType = 'syn' } = params;

  // Safety: validate target
  if (!target || typeof target !== 'string') {
    throw new Error('Invalid target');
  }

  // Build scan arguments
  let scanArgs = '';
  switch (scanType) {
    case 'syn':
      scanArgs = '-sS'; // SYN scan (requires root)
      break;
    case 'connect':
      scanArgs = '-sT'; // Connect scan
      break;
    case 'service':
      scanArgs = '-sV'; // Service version detection
      break;
    default:
      scanArgs = '-sT';
  }

  const command = `nmap ${scanArgs} -p ${ports} ${target} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout: 60000 });
    return stdout;
  } catch (error: any) {
    // nmap might fail without root permissions for SYN scan
    if (scanType === 'syn' && error.message.includes('permission')) {
      // Retry with connect scan
      const fallbackCommand = `nmap -sT -p ${ports} ${target} 2>&1`;
      const { stdout } = await execAsync(fallbackCommand, { timeout: 60000 });
      return `Note: SYN scan requires root, using Connect scan instead\n\n${stdout}`;
    }
    throw error;
  }
}

/**
 * DNS lookup using dig
 */
async function runDnsLookup(params: any): Promise<string> {
  const { target, recordType = 'A' } = params;

  if (!target || typeof target !== 'string') {
    throw new Error('Invalid target');
  }

  const command = `dig ${target} ${recordType} +short 2>&1`;

  const { stdout, stderr } = await execAsync(command, { timeout: 10000 });

  return stdout || stderr || 'No results';
}

/**
 * Ping test
 */
async function runPing(params: any): Promise<string> {
  const { target, count = 10 } = params;

  if (!target || typeof target !== 'string') {
    throw new Error('Invalid target');
  }

  const safeCount = Math.min(Math.max(count, 1), 100);

  const command = `ping -c ${safeCount} ${target} 2>&1`;

  const { stdout, stderr } = await execAsync(command, { timeout: (safeCount + 5) * 1000 });

  return stdout || stderr;
}

/**
 * Traceroute
 */
async function runTraceroute(params: any): Promise<string> {
  const { target, maxHops = 30 } = params;

  if (!target || typeof target !== 'string') {
    throw new Error('Invalid target');
  }

  const safeHops = Math.min(Math.max(maxHops, 1), 64);

  const command = `traceroute -m ${safeHops} ${target} 2>&1`;

  const { stdout, stderr } = await execAsync(command, { timeout: 60000 });

  return stdout || stderr;
}

/**
 * Network discovery (calls our comprehensive scanner)
 */
async function runNetworkDiscovery(params: any): Promise<string> {
  const { timeout = 15, arpScan = true, mdnsScan = true, ssdpScan = true, vendorLookup = true } = params;

  const { scanNetwork } = await import('../../../../../lib/discovery/network-scanner');

  const devices = await scanNetwork({
    arpScan,
    mdnsScan,
    ssdpScan,
    vendorLookup,
    timeout,
  });

  // Format output
  let output = `Network Discovery Results\n`;
  output += `=========================\n\n`;
  output += `Found ${devices.length} devices:\n\n`;

  for (const device of devices) {
    output += `${device.ip} - ${device.metadata.friendlyName || device.hostname || 'Unknown'}\n`;
    output += `  Type: ${device.deviceType} (${device.confidence} confidence)\n`;
    if (device.vendor) output += `  Vendor: ${device.vendor}\n`;
    if (device.mac) output += `  MAC: ${device.mac}\n`;
    if (device.metadata.manufacturer) output += `  Manufacturer: ${device.metadata.manufacturer}\n`;
    if (device.metadata.model) output += `  Model: ${device.metadata.model}\n`;
    output += `\n`;
  }

  return output;
}
