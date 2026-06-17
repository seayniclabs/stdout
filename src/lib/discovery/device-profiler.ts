/**
 * Device Profiler
 * Combines signals from multiple discovery methods to classify and profile network devices
 */

import type { MDNSService } from './mdns-scanner';
import type { SSDPDevice } from './ssdp-scanner';
import type { VendorInfo } from './mac-vendor';
import { classifyMDNSDevice } from './mdns-scanner';
import { classifySSDPDevice } from './ssdp-scanner';
import { inferDeviceTypeFromVendor } from './mac-vendor';

export interface DeviceProfile {
  ip: string;
  mac?: string;
  hostname?: string;
  vendor?: string;
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
  signals: {
    arp?: boolean;
    mdns?: MDNSService[];
    ssdp?: SSDPDevice[];
    vendor?: VendorInfo;
    ports?: number[];
  };
  metadata: {
    friendlyName?: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    os?: string;
    services?: string[];
  };
}

/**
 * Combine multiple discovery signals to create a comprehensive device profile
 */
export function profileDevice(
  ip: string,
  signals: {
    mac?: string;
    hostname?: string;
    mdnsServices?: MDNSService[];
    ssdpDevices?: SSDPDevice[];
    vendorInfo?: VendorInfo | null;
    openPorts?: number[];
  }
): DeviceProfile {
  const { mac, hostname, mdnsServices = [], ssdpDevices = [], vendorInfo, openPorts = [] } = signals;

  // Collect device type classifications from all sources
  const typeVotes: string[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // mDNS classification
  for (const service of mdnsServices) {
    const type = classifyMDNSDevice(service);
    if (type !== 'unknown') {
      typeVotes.push(type);
    }
  }

  // SSDP classification
  for (const device of ssdpDevices) {
    const type = classifySSDPDevice(device);
    if (type !== 'upnp-device') {
      // upnp-device is the generic fallback
      typeVotes.push(type);
    }
  }

  // Vendor-based inference
  if (vendorInfo) {
    const vendorType = inferDeviceTypeFromVendor(vendorInfo.vendor);
    if (vendorType) {
      typeVotes.push(vendorType);
    }
  }

  // Port-based heuristics
  if (openPorts.length > 0) {
    const portType = inferTypeFromPorts(openPorts);
    if (portType) {
      typeVotes.push(portType);
    }
  }

  // Determine final device type by voting
  let deviceType = 'unknown';
  if (typeVotes.length > 0) {
    // Count votes
    const voteCounts = new Map<string, number>();
    for (const vote of typeVotes) {
      voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
    }

    // Pick most common type
    let maxVotes = 0;
    for (const [type, count] of voteCounts.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        deviceType = type;
      }
    }

    // Determine confidence based on vote consensus
    if (maxVotes >= 3) {
      confidence = 'high';
    } else if (maxVotes >= 2 || typeVotes.length >= 2) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
  }

  // Collect metadata from all sources
  const metadata: DeviceProfile['metadata'] = {
    services: [],
  };

  // From mDNS
  if (mdnsServices.length > 0) {
    metadata.services = mdnsServices.map((s) => s.type);

    // Try to extract friendly name
    const httpService = mdnsServices.find((s) => s.type.includes('_http'));
    if (httpService?.txt?.product) {
      metadata.friendlyName = httpService.txt.product;
    }
  }

  // From SSDP
  if (ssdpDevices.length > 0) {
    const primaryDevice = ssdpDevices[0]; // Use first device as primary
    if (primaryDevice.friendlyName) metadata.friendlyName = primaryDevice.friendlyName;
    if (primaryDevice.manufacturer) metadata.manufacturer = primaryDevice.manufacturer;
    if (primaryDevice.modelName) metadata.model = primaryDevice.modelName;
    if (primaryDevice.serialNumber) metadata.serialNumber = primaryDevice.serialNumber;
  }

  // From vendor
  if (vendorInfo && !metadata.manufacturer) {
    metadata.manufacturer = vendorInfo.vendor;
  }

  // Hostname-based metadata
  if (hostname) {
    metadata.friendlyName = metadata.friendlyName || hostname;

    // Infer OS from hostname patterns
    if (hostname.endsWith('.local')) {
      metadata.os = 'macOS/iOS'; // Likely Apple device
    } else if (hostname.includes('android')) {
      metadata.os = 'Android';
    }
  }

  return {
    ip,
    mac,
    hostname,
    vendor: vendorInfo?.vendor,
    deviceType,
    confidence,
    signals: {
      arp: true, // If we got this far, ARP found the device
      mdns: mdnsServices.length > 0 ? mdnsServices : undefined,
      ssdp: ssdpDevices.length > 0 ? ssdpDevices : undefined,
      vendor: vendorInfo || undefined,
      ports: openPorts.length > 0 ? openPorts : undefined,
    },
    metadata,
  };
}

/**
 * Infer device type from open ports
 */
function inferTypeFromPorts(ports: number[]): string | null {
  const portSet = new Set(ports);

  // Web server
  if (portSet.has(80) || portSet.has(443) || portSet.has(8080)) {
    return 'web-server';
  }

  // SSH server
  if (portSet.has(22)) {
    return 'ssh-server';
  }

  // File servers
  if (portSet.has(445) || portSet.has(139)) {
    // SMB
    return 'file-server';
  }

  if (portSet.has(548)) {
    // AFP (Apple Filing Protocol)
    return 'file-server';
  }

  // Printers
  if (portSet.has(631) || portSet.has(9100)) {
    // IPP or JetDirect
    return 'printer';
  }

  // Database servers
  if (portSet.has(3306) || portSet.has(5432) || portSet.has(27017)) {
    return 'database-server';
  }

  // Media servers
  if (portSet.has(32400)) {
    // Plex
    return 'media-server';
  }

  return null;
}

/**
 * Normalize device type to canonical categories
 */
export function normalizeDeviceType(type: string): string {
  const typeMap: Record<string, string> = {
    'apple-device': 'mobile-device',
    'samsung-device': 'mobile-device',
    'sony-device': 'entertainment-device',
    'amazon-device': 'smart-home',
    'google-device': 'smart-home',
    'homekit-device': 'smart-home',
    'airplay-device': 'entertainment-device',
    'smart-speaker': 'smart-home',
    'streaming-device': 'entertainment-device',
    'gaming-console': 'entertainment-device',
    'hp-device': 'peripheral',
    'canon-device': 'peripheral',
    'single-board-computer': 'computer',
    'ssh-server': 'server',
    'web-server': 'server',
    'database-server': 'server',
    'file-server': 'server',
    'media-server': 'server',
    'network-device': 'infrastructure',
    'router': 'infrastructure',
    'upnp-device': 'unknown',
  };

  return typeMap[type] || type;
}
