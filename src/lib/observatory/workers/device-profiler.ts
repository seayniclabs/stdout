/**
 * Device Profiler - Rich discovery like AngryIP/Fing
 * Gathers: MAC, vendor, open ports, services, OS detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DeviceProfile {
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  openPorts: number[];
  services: Array<{ port: number; service: string; version?: string }>;
  osGuess?: string;
  deviceType?: string;
  lastSeen: number;
}

/**
 * Get MAC address from ARP table
 */
async function getMacAddress(ip: string): Promise<{ mac?: string; vendor?: string }> {
  try {
    const { stdout } = await execAsync(`arp -n ${ip}`);
    const lines = stdout.split("\\n");
    
    for (const line of lines) {
      if (line.includes(ip)) {
        // Format: 192.168.68.1 ether aa:bb:cc:dd:ee:ff C eth0
        const parts = line.split(/\\s+/);
        const macIndex = parts.findIndex(p => /^[0-9a-f]{2}:[0-9a-f]{2}:/i.test(p));
        if (macIndex !== -1) {
          const mac = parts[macIndex];
          const vendor = await getVendorFromMac(mac);
          return { mac, vendor };
        }
      }
    }
  } catch (e) {
    // ARP entry might not exist yet
  }
  
  return {};
}

/**
 * Lookup vendor from MAC OUI (first 3 octets)
 * Using IEEE OUI database approximation
 */
async function getVendorFromMac(mac: string): Promise<string | undefined> {
  const oui = mac.substring(0, 8).toUpperCase().replace(/:/g, "");
  
  // Common vendor prefixes (simplified)
  const vendors: Record<string, string> = {
    "000000": "Xerox",
    "00005E": "ICANN",
    "0050F2": "Microsoft",
    "001B63": "Apple",
    "B827EB": "Raspberry Pi Foundation",
    "DCA632": "Raspberry Pi Trading",
    "E45F01": "Raspberry Pi",
    "DC2100": "Ubiquiti Networks",
    "F09FC2": "Ubiquiti Networks",
    "788A20": "Ubiquiti Networks",
    // Add more as needed
  };
  
  return vendors[oui];
}

/**
 * Port scan and service detection
 */
async function scanPorts(ip: string): Promise<{
  openPorts: number[];
  services: Array<{ port: number; service: string; version?: string }>;
  osGuess?: string;
}> {
  try {
    // Fast scan of common ports (without -sV since NSE scripts aren't available in Alpine)
    // Use -sT (TCP connect) instead of -sS (SYN) - works without NET_RAW capability
    const { stdout } = await execAsync(
      `nmap -sT -T4 --top-ports 100 ${ip}`,
      { timeout: 30000 }
    );
    
    const openPorts: number[] = [];
    const services: Array<{ port: number; service: string; version?: string }> = [];
    let osGuess: string | undefined;
    
    const lines = stdout.split("\\n");
    for (const line of lines) {
      // Parse open ports: Ports: 22/open/tcp//ssh//OpenSSH 8.2/
      if (line.includes("Ports:")) {
        const portsSection = line.split("Ports:")[1];
        const portEntries = portsSection.split(",");
        
        for (const entry of portEntries) {
          const parts = entry.trim().split("/");
          if (parts.length >= 3 && parts[1] === "open") {
            const port = parseInt(parts[0]);
            const service = parts[4] || "unknown";
            const version = parts[6];
            
            openPorts.push(port);
            services.push({ port, service, version });
          }
        }
      }
      
      // Parse OS guess if available
      if (line.includes("OS:")) {
        osGuess = line.split("OS:")[1].trim();
      }
    }
    
    return { openPorts, services, osGuess };
  } catch (e) {
    console.error(`[Profiler] Port scan failed for ${ip}:`, e);
    return { openPorts: [], services: [] };
  }
}

/**
 * Guess device type from discovered data using enhanced classifier
 */
function guessDeviceType(profile: Partial<DeviceProfile>): string {
  // Use the enhanced classifier for better accuracy
  const { classifyDevice } = require('./enhanced-classifier');

  const classification = classifyDevice({
    ip: profile.ip || "",
    hostname: profile.hostname,
    mac: profile.mac,
    vendor: profile.vendor,
    openPorts: profile.openPorts || [],
    services: profile.services || [],
    osGuess: profile.osGuess,
  });

  // Log classification reasoning for debugging
  if (classification.confidence > 0.7) {
    console.log(`[Classifier] ${profile.ip} → ${classification.deviceType} (${Math.round(classification.confidence * 100)}% confidence)`);
  }

  return classification.deviceType;
}

/**
 * Profile a network device completely
 */
export async function profileDevice(ip: string, hostname?: string): Promise<DeviceProfile> {
  console.log(`[Profiler] Profiling ${ip}...`);
  
  // Get MAC and vendor
  const { mac, vendor } = await getMacAddress(ip);
  
  // Scan ports and detect services
  const { openPorts, services, osGuess } = await scanPorts(ip);
  
  // Build profile
  const profile: DeviceProfile = {
    ip,
    hostname,
    mac,
    vendor,
    openPorts,
    services,
    osGuess,
    deviceType: "",
    lastSeen: Date.now(),
  };
  
  // Guess device type
  profile.deviceType = guessDeviceType(profile);
  
  console.log(`[Profiler] ${ip}: ${profile.deviceType} | MAC: ${mac || "unknown"} | Ports: ${openPorts.length}`);
  
  return profile;
}

/**
 * Profile multiple devices in parallel (with concurrency limit)
 */
export async function profileDevices(
  devices: Array<{ ip: string; hostname?: string }>,
  concurrency = 5
): Promise<DeviceProfile[]> {
  const results: DeviceProfile[] = [];
  
  // Process in batches to avoid overwhelming nmap
  for (let i = 0; i < devices.length; i += concurrency) {
    const batch = devices.slice(i, i + concurrency);
    const profiles = await Promise.all(
      batch.map(d => profileDevice(d.ip, d.hostname))
    );
    results.push(...profiles);
  }
  
  return results;
}
