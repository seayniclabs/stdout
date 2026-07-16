/**
 * Comprehensive Network Scanner
 * Orchestrates ARP, mDNS, SSDP, and vendor lookups for Fing-level discovery
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { scanMDNS } from './mdns-scanner';
import { scanSDP } from './ssdp-scanner';
import { lookupMACVendorBatch } from './mac-vendor';
import { profileDevice, type DeviceProfile } from './device-profiler';

const execAsync = promisify(exec);

export interface ARPEntry {
  ip: string;
  mac: string;
  interface: string;
}

/**
 * Perform ARP scan to discover all hosts on local network(s)
 */
export async function scanARP(): Promise<ARPEntry[]> {
  const hosts: ARPEntry[] = [];

  try {
    // Use arp -a to get all ARP cache entries
    const { stdout } = await execAsync('arp -a');

    // Parse arp output
    // Format varies by platform:
    // macOS: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
    // Linux: "192.168.1.1 ether aa:bb:cc:dd:ee:ff C eth0"

    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      // Extract IP and MAC address
      const ipMatch = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
      const macMatch = line.match(/([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}/);

      if (ipMatch && macMatch) {
        const ip = ipMatch[1];
        const mac = macMatch[0];

        // Extract interface (en0, eth0, etc.)
        let iface = 'unknown';
        const macOSIfaceMatch = line.match(/on (\w+)/);
        if (macOSIfaceMatch) {
          iface = macOSIfaceMatch[1];
        } else {
          const linuxIfaceMatch = line.match(/\s+(\w+)$/);
          if (linuxIfaceMatch) {
            iface = linuxIfaceMatch[1];
          }
        }

        hosts.push({ ip, mac, interface: iface });
      }
    }
  } catch (error: unknown) {
    console.error('[network-scanner] ARP scan failed:', error instanceof Error ? error.message : String(error));
  }

  return hosts;
}

/**
 * Comprehensive network scan combining all discovery methods
 */
export async function scanNetwork(options: {
  arpScan?: boolean;
  mdnsScan?: boolean;
  ssdpScan?: boolean;
  vendorLookup?: boolean;
  timeout?: number;
} = {}): Promise<DeviceProfile[]> {
  const {
    arpScan = true,
    mdnsScan = true,
    ssdpScan = true,
    vendorLookup = true,
    timeout = 10,
  } = options;

  console.log('[network-scanner] Starting comprehensive network scan...');

  // Start all scans in parallel
  const [arpEntries, mdnsServices, ssdpDevices] = await Promise.all([
    arpScan ? scanARP() : Promise.resolve([]),
    mdnsScan ? scanMDNS(timeout) : Promise.resolve([]),
    ssdpScan ? scanSDP(timeout) : Promise.resolve([]),
  ]);

  console.log(`[network-scanner] Discovered: ${arpEntries.length} ARP, ${mdnsServices.length} mDNS, ${ssdpDevices.length} SSDP`);

  // Build IP → signals map
  const deviceMap = new Map<string, any>();

  // Populate from ARP
  for (const entry of arpEntries) {
    deviceMap.set(entry.ip, {
      mac: entry.mac,
      hostname: null,
      mdnsServices: [],
      ssdpDevices: [],
      vendorInfo: null,
    });
  }

  // Add mDNS services
  for (const service of mdnsServices) {
    if (service.address) {
      const existing = deviceMap.get(service.address) || {
        mac: null,
        hostname: service.hostname,
        mdnsServices: [],
        ssdpDevices: [],
        vendorInfo: null,
      };

      existing.mdnsServices.push(service);
      if (!existing.hostname) existing.hostname = service.hostname;

      deviceMap.set(service.address, existing);
    }
  }

  // Add SSDP devices
  for (const device of ssdpDevices) {
    if (device.address) {
      const existing = deviceMap.get(device.address) || {
        mac: null,
        hostname: device.friendlyName || null,
        mdnsServices: [],
        ssdpDevices: [],
        vendorInfo: null,
      };

      existing.ssdpDevices.push(device);
      if (!existing.hostname && device.friendlyName) {
        existing.hostname = device.friendlyName;
      }

      deviceMap.set(device.address, existing);
    }
  }

  // Vendor lookups (batch)
  if (vendorLookup) {
    const macAddresses = Array.from(deviceMap.values())
      .map((d) => d.mac)
      .filter((mac): mac is string => !!mac);

    if (macAddresses.length > 0) {
      console.log(`[network-scanner] Looking up ${macAddresses.length} MAC vendors...`);
      const vendorResults = await lookupMACVendorBatch(macAddresses);

      for (const [ip, signals] of deviceMap.entries()) {
        if (signals.mac) {
          const vendorInfo = vendorResults.get(signals.mac);
          if (vendorInfo) {
            signals.vendorInfo = vendorInfo;
          }
        }
      }
    }
  }

  // Profile each device
  const profiles: DeviceProfile[] = [];

  for (const [ip, signals] of deviceMap.entries()) {
    const profile = profileDevice(ip, signals);
    profiles.push(profile);
  }

  console.log(`[network-scanner] Profiled ${profiles.length} devices`);

  return profiles;
}
