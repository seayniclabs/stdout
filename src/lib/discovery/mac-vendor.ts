/**
 * MAC Address Vendor Lookup
 * Identifies device manufacturers from MAC addresses using IEEE OUI database
 */

export interface VendorInfo {
  vendor: string;
  prefix: string;
}

/**
 * Lookup vendor from MAC address
 * Uses macvendors.com API (free, no authentication required)
 */
export async function lookupMACVendor(macAddress: string): Promise<VendorInfo | null> {
  try {
    // Clean MAC address (remove separators)
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();

    // Extract OUI (first 6 hex digits)
    const oui = cleanMac.substring(0, 6);

    // Check local cache first
    const cached = ouiCache.get(oui);
    if (cached) return cached;

    // Query macvendors.com API
    const response = await fetch(`https://api.macvendors.com/${macAddress}`, {
      signal: AbortSignal.timeout(3000),
    });

    if (response.status === 404) {
      // OUI not found
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const vendor = await response.text();

    const vendorInfo: VendorInfo = {
      vendor: vendor.trim(),
      prefix: oui,
    };

    // Cache the result
    ouiCache.set(oui, vendorInfo);

    return vendorInfo;
  } catch (error: unknown) {
    console.error('[mac-vendor] Lookup failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Lookup multiple MAC addresses in batch
 * Includes rate limiting to avoid API throttling
 */
export async function lookupMACVendorBatch(macAddresses: string[]): Promise<Map<string, VendorInfo | null>> {
  const results = new Map<string, VendorInfo | null>();

  for (const mac of macAddresses) {
    const oui = mac.replace(/[:-]/g, '').toUpperCase().substring(0, 6);

    // Check cache first
    if (ouiCache.has(oui)) {
      results.set(mac, ouiCache.get(oui)!);
      continue;
    }

    // Lookup with rate limiting (1 request per 200ms to avoid throttling)
    await new Promise((resolve) => setTimeout(resolve, 200));

    const vendorInfo = await lookupMACVendor(mac);
    results.set(mac, vendorInfo);
  }

  return results;
}

/**
 * Infer device type from vendor name
 */
export function inferDeviceTypeFromVendor(vendor: string): string | null {
  const vendorLower = vendor.toLowerCase();

  // Smart home manufacturers
  if (
    vendorLower.includes('philips') ||
    vendorLower.includes('lifx') ||
    vendorLower.includes('nanoleaf') ||
    vendorLower.includes('wyze') ||
    vendorLower.includes('ring') ||
    vendorLower.includes('nest') ||
    vendorLower.includes('ecobee')
  ) {
    return 'smart-home-device';
  }

  // Apple devices
  if (vendorLower.includes('apple')) {
    return 'apple-device';
  }

  // Samsung devices (could be TV, phone, appliance)
  if (vendorLower.includes('samsung')) {
    return 'samsung-device';
  }

  // LG devices (often TVs)
  if (vendorLower.includes('lg electronics')) {
    return 'smart-tv';
  }

  // Sony devices (often TVs or gaming consoles)
  if (vendorLower.includes('sony')) {
    return 'sony-device';
  }

  // Roku
  if (vendorLower.includes('roku')) {
    return 'streaming-device';
  }

  // Amazon devices (Echo, Fire TV, etc.)
  if (vendorLower.includes('amazon')) {
    return 'amazon-device';
  }

  // Google devices (Chromecast, Nest, etc.)
  if (vendorLower.includes('google')) {
    return 'google-device';
  }

  // Sonos speakers
  if (vendorLower.includes('sonos')) {
    return 'smart-speaker';
  }

  // TP-Link (routers, smart plugs)
  if (vendorLower.includes('tp-link')) {
    return 'networking-or-smart-device';
  }

  // Ubiquiti (networking equipment)
  if (vendorLower.includes('ubiquiti')) {
    return 'network-device';
  }

  // Cisco (networking equipment)
  if (vendorLower.includes('cisco')) {
    return 'network-device';
  }

  // Netgear (networking equipment)
  if (vendorLower.includes('netgear')) {
    return 'network-device';
  }

  // Raspberry Pi
  if (vendorLower.includes('raspberry pi')) {
    return 'single-board-computer';
  }

  // HP (printers, laptops)
  if (vendorLower.includes('hewlett packard') || vendorLower.includes('hp inc')) {
    return 'hp-device';
  }

  // Canon (printers, cameras)
  if (vendorLower.includes('canon')) {
    return 'canon-device';
  }

  // Epson (printers)
  if (vendorLower.includes('epson')) {
    return 'printer';
  }

  return null;
}

/**
 * In-memory OUI cache to reduce API calls
 * Keyed by 6-character OUI prefix
 */
const ouiCache = new Map<string, VendorInfo>();

/**
 * Pre-populate cache with common vendors to reduce API calls
 */
export function initializeCommonVendors() {
  const commonVendors: Array<[string, string]> = [
    ['001122', 'CIMSYS Inc'],
    ['00000C', 'Cisco Systems, Inc'],
    ['3C5282', 'Google, Inc.'],
    ['B827EB', 'Raspberry Pi Foundation'],
    ['DC9FDB', 'Ubiquiti Inc'],
    ['F09FC2', 'Apple, Inc.'],
    ['A4C138', 'Apple, Inc.'],
    ['ACB57D', 'Apple, Inc.'],
    ['001D4F', 'Apple, Inc.'],
    ['B8E856', 'Apple, Inc.'],
    ['D023DB', 'Apple, Inc.'],
    ['008865', 'Samsung Electronics Co.,Ltd'],
    ['0024E4', 'Samsung Electronics Co.,Ltd'],
    ['CC2D83', 'Samsung Electronics Co.,Ltd'],
    ['203CAE', 'LG Electronics (Mobile Communications)'],
    ['18EC E7', 'Sony Corporation'],
    ['DC68EB', 'Amazon Technologies Inc.'],
    ['F0D1A9', 'TP-Link Corporation Limited'],
    ['50C7BF', 'TP-Link Corporation Limited'],
    ['789ED0', 'Sonos, Inc.'],
    ['B8E937', 'Sonos, Inc.'],
  ];

  for (const [oui, vendor] of commonVendors) {
    ouiCache.set(oui, { vendor, prefix: oui });
  }
}

// Initialize common vendors on module load
initializeCommonVendors();
