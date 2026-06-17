/**
 * mDNS/Bonjour Network Discovery
 * Discovers Apple devices, printers, smart speakers, and other services advertising via mDNS
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MDNSService {
  name: string;
  type: string;
  domain: string;
  hostname: string;
  address: string;
  port: number;
  txt: Record<string, string>;
}

/**
 * Scan for mDNS/Bonjour services on the network
 * Uses avahi-browse on Linux, dns-sd on macOS
 */
export async function scanMDNS(timeoutSeconds: number = 10): Promise<MDNSService[]> {
  const services: MDNSService[] = [];

  try {
    // Detect platform
    const platform = process.platform;

    if (platform === 'linux') {
      // Use avahi-browse on Linux
      const { stdout } = await execAsync(`timeout ${timeoutSeconds} avahi-browse -a -t -r -p || true`);

      // Parse avahi-browse output
      // Format: =;eth0;IPv4;Service Name;_service._tcp;local;hostname.local;192.168.1.100;9;txtrecord
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (line.startsWith('=')) {
          const parts = line.split(';');
          if (parts.length >= 9) {
            const [, iface, ipv, name, serviceType, domain, hostname, address, port, ...txtParts] = parts;

            // Parse TXT records
            const txt: Record<string, string> = {};
            const txtRecord = txtParts.join(';');
            if (txtRecord) {
              // TXT records are in "key=value" format
              const txtEntries = txtRecord.match(/"([^"]+)"/g) || [];
              for (const entry of txtEntries) {
                const cleaned = entry.replace(/"/g, '');
                const [key, ...valueParts] = cleaned.split('=');
                if (key) {
                  txt[key] = valueParts.join('=') || '';
                }
              }
            }

            services.push({
              name,
              type: serviceType,
              domain,
              hostname,
              address,
              port: parseInt(port, 10) || 0,
              txt,
            });
          }
        }
      }
    } else if (platform === 'darwin') {
      // Use dns-sd on macOS
      // dns-sd doesn't have a timeout flag, so we'll use timeout command
      const { stdout } = await execAsync(`timeout ${timeoutSeconds} dns-sd -B _services._dns-sd._udp local. || true`);

      // Note: dns-sd requires separate lookups per service type
      // For a complete scan, we'd need to enumerate common service types
      // This is a simplified implementation
      const commonTypes = [
        '_airplay._tcp',
        '_homekit._tcp',
        '_http._tcp',
        '_ssh._tcp',
        '_sftp-ssh._tcp',
        '_printer._tcp',
        '_ipp._tcp',
        '_scanner._tcp',
        '_smb._tcp',
        '_afpovertcp._tcp',
      ];

      for (const serviceType of commonTypes) {
        try {
          const { stdout: serviceStdout } = await execAsync(
            `timeout 2 dns-sd -L "${serviceType.replace('_', '')}" "${serviceType}" local. || true`
          );

          // Parse dns-sd output
          // This is a simplified parser - dns-sd output is complex
          const lines = serviceStdout.split('\n');
          for (const line of lines) {
            if (line.includes('can be reached at')) {
              // Example: "MyDevice._http._tcp.local. can be reached at mydevice.local.:8080"
              const match = line.match(/(.+?)\s+can be reached at\s+(.+?):(\d+)/);
              if (match) {
                services.push({
                  name: match[1],
                  type: serviceType,
                  domain: 'local',
                  hostname: match[2],
                  address: '', // dns-sd doesn't provide IP directly
                  port: parseInt(match[3], 10),
                  txt: {},
                });
              }
            }
          }
        } catch (err) {
          // Service type not found, continue
        }
      }
    }
  } catch (error: any) {
    console.error('[mdns-scanner] Error scanning mDNS:', error.message);
  }

  return services;
}

/**
 * Classify device type from mDNS service information
 */
export function classifyMDNSDevice(service: MDNSService): string {
  const type = service.type.toLowerCase();
  const name = service.name.toLowerCase();
  const txt = service.txt || {};

  // AirPlay devices (Apple TV, HomePod, AirPlay speakers)
  if (type.includes('_airplay')) return 'airplay-device';

  // HomeKit devices
  if (type.includes('_homekit') || type.includes('_hap')) return 'homekit-device';

  // Printers
  if (type.includes('_printer') || type.includes('_ipp') || type.includes('_pdl-datastream')) {
    return 'printer';
  }

  // Scanners
  if (type.includes('_scanner') || type.includes('_uscan')) return 'scanner';

  // Web servers
  if (type.includes('_http')) {
    // Check TXT records for more specific classification
    if (txt.product && txt.product.toLowerCase().includes('camera')) return 'ip-camera';
    if (txt.product && txt.product.toLowerCase().includes('nas')) return 'nas';
    return 'web-server';
  }

  // SSH/SFTP servers
  if (type.includes('_ssh') || type.includes('_sftp')) return 'ssh-server';

  // File servers
  if (type.includes('_smb') || type.includes('_afpovertcp')) return 'file-server';

  // Smart speakers
  if (name.includes('homepod') || name.includes('alexa') || name.includes('google home')) {
    return 'smart-speaker';
  }

  return 'unknown';
}
