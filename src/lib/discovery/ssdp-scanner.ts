/**
 * SSDP/UPnP Network Discovery
 * Discovers Smart TVs, media players, streaming devices, routers, and other UPnP devices
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as dgram from 'dgram';

const execAsync = promisify(exec);

export interface SSDPDevice {
  location: string;
  server: string;
  usn: string;
  st: string; // Search target (device/service type)
  ext?: string;
  cacheControl?: string;
  deviceType?: string;
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  modelNumber?: string;
  serialNumber?: string;
  address?: string;
}

/**
 * Perform SSDP M-SEARCH discovery
 * Sends multicast discovery packets and collects responses
 */
export async function scanSDP(timeoutSeconds: number = 10): Promise<SSDPDevice[]> {
  const devices: SSDPDevice[] = [];
  const seen = new Set<string>();

  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    // SSDP M-SEARCH message
    const searchTargets = [
      'ssdp:all', // All UPnP devices
      'upnp:rootdevice', // Root devices
      'urn:schemas-upnp-org:device:MediaRenderer:1', // Media renderers (Smart TVs, etc.)
      'urn:schemas-upnp-org:device:MediaServer:1', // Media servers
      'urn:dial-multiscreen-org:service:dial:1', // DIAL protocol (Chromecast, Smart TVs)
    ];

    let completedSearches = 0;

    socket.on('message', async (msg, rinfo) => {
      const response = msg.toString();
      const headers = parseHttpHeaders(response);

      // Avoid duplicates
      const usn = headers.usn || headers.location || '';
      if (!usn || seen.has(usn)) return;
      seen.add(usn);

      const device: SSDPDevice = {
        location: headers.location || '',
        server: headers.server || '',
        usn: headers.usn || '',
        st: headers.st || '',
        ext: headers.ext,
        cacheControl: headers['cache-control'],
        address: rinfo.address,
      };

      // Fetch device description XML if location is provided
      if (device.location) {
        try {
          const deviceInfo = await fetchDeviceDescription(device.location);
          Object.assign(device, deviceInfo);
        } catch (err) {
          // Failed to fetch description, keep basic info
        }
      }

      devices.push(device);
    });

    socket.on('error', (err) => {
      console.error('[ssdp-scanner] Socket error:', err.message);
      socket.close();
      resolve(devices);
    });

    socket.bind(0, () => {
      // Send M-SEARCH for each search target
      for (const st of searchTargets) {
        const message = [
          'M-SEARCH * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'MAN: "ssdp:discover"',
          `MX: ${timeoutSeconds}`,
          `ST: ${st}`,
          '',
          '',
        ].join('\r\n');

        socket.send(message, 1900, '239.255.255.250', (err) => {
          if (err) {
            console.error('[ssdp-scanner] Failed to send M-SEARCH:', err.message);
          }

          completedSearches++;
          if (completedSearches === searchTargets.length) {
            // All searches sent, wait for timeout
            setTimeout(() => {
              socket.close();
              resolve(devices);
            }, timeoutSeconds * 1000);
          }
        });
      }
    });
  });
}

/**
 * Parse HTTP-style headers from SSDP response
 */
function parseHttpHeaders(response: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = response.split('\r\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Fetch and parse UPnP device description XML
 */
async function fetchDeviceDescription(location: string): Promise<Partial<SSDPDevice>> {
  try {
    const response = await fetch(location, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();

    // Parse XML (simple regex-based parsing for key fields)
    const deviceType = xml.match(/<deviceType>([^<]+)<\/deviceType>/)?.[1];
    const friendlyName = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/)?.[1];
    const manufacturer = xml.match(/<manufacturer>([^<]+)<\/manufacturer>/)?.[1];
    const modelName = xml.match(/<modelName>([^<]+)<\/modelName>/)?.[1];
    const modelNumber = xml.match(/<modelNumber>([^<]+)<\/modelNumber>/)?.[1];
    const serialNumber = xml.match(/<serialNumber>([^<]+)<\/serialNumber>/)?.[1];

    return {
      deviceType,
      friendlyName,
      manufacturer,
      modelName,
      modelNumber,
      serialNumber,
    };
  } catch (error: any) {
    // Failed to fetch or parse, return empty
    return {};
  }
}

/**
 * Classify device type from SSDP information
 */
export function classifySSDPDevice(device: SSDPDevice): string {
  const deviceType = (device.deviceType || '').toLowerCase();
  const friendlyName = (device.friendlyName || '').toLowerCase();
  const modelName = (device.modelName || '').toLowerCase();
  const server = (device.server || '').toLowerCase();

  // Smart TVs
  if (
    deviceType.includes('mediarenderer') ||
    friendlyName.includes('tv') ||
    modelName.includes('tv') ||
    friendlyName.includes('roku') ||
    friendlyName.includes('chromecast') ||
    friendlyName.includes('fire tv') ||
    server.includes('dial')
  ) {
    return 'smart-tv';
  }

  // Media servers (NAS, Plex, etc.)
  if (deviceType.includes('mediaserver') || friendlyName.includes('plex') || friendlyName.includes('nas')) {
    return 'media-server';
  }

  // Routers
  if (
    deviceType.includes('internetgateway') ||
    deviceType.includes('wandevice') ||
    friendlyName.includes('router') ||
    friendlyName.includes('gateway')
  ) {
    return 'router';
  }

  // Printers
  if (friendlyName.includes('printer') || modelName.includes('printer')) {
    return 'printer';
  }

  // Gaming consoles
  if (
    friendlyName.includes('playstation') ||
    friendlyName.includes('xbox') ||
    friendlyName.includes('nintendo')
  ) {
    return 'gaming-console';
  }

  return 'upnp-device';
}
