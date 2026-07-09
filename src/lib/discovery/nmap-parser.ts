export interface DiscoveredService {
  port: number;
  protocol: string;
  serviceName?: string;
  serviceVersion?: string;
}

export interface DiscoveredHost {
  ip: string;
  mac?: string;
  vendor?: string;
  hostname?: string;
  status: string;
  ports: DiscoveredService[];
}

/**
 * Sanitizes input string to remove non-printable ASCII control characters.
 * Matches Task 8 QA strict requirements: "Service names and product versions must be sanitized to strip non-printable ASCII characters before indexing."
 */
export function sanitizeString(val: string): string {
  if (!val) return '';
  return val.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

/**
 * Helper to parse attributes from an XML/HTML tag.
 * Handles single/double quotes, spaces, and preserves all attribute values.
 */
export function parseXmlAttributes(tagContent: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRegex.exec(tagContent)) !== null) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return attrs;
}

/**
 * Parses Nmap XML output.
 */
export function parseNmapXml(xmlContent: string): { hosts: DiscoveredHost[]; errors: string[] } {
  const errors: string[] = [];
  const hosts: DiscoveredHost[] = [];
  
  // Extract <host>...</host> blocks
  const hostRegex = /<host[\s\S]*?<\/host>/g;
  let match;
  let hostIndex = 0;
  
  while ((match = hostRegex.exec(xmlContent)) !== null) {
    const hostBlock = match[0];
    
    // Status
    const statusTag = hostBlock.match(/<status\s+[^>]*>/)?.[0];
    const statusAttrs = statusTag ? parseXmlAttributes(statusTag) : {};
    const status = statusAttrs['state'] || 'unknown';
    
    // Only process active hosts
    if (status !== 'up') continue;

    // Addresses
    let ip: string | undefined = undefined;
    let mac: string | undefined = undefined;
    let vendor: string | undefined = undefined;
    
    const addressTags = hostBlock.match(/<address\s+[^>]*>/g) || [];
    for (const tag of addressTags) {
      const attrs = parseXmlAttributes(tag);
      const addr = attrs['addr'];
      const type = attrs['addrtype'];
      const vend = attrs['vendor'];
      if (type === 'ipv4' || type === 'ipv6') {
        ip = addr;
      } else if (type === 'mac') {
        mac = addr;
        if (vend) vendor = vend;
      }
    }
    
    // Hostname
    let hostname: string | undefined = undefined;
    const hostnameTags = hostBlock.match(/<hostname\s+[^>]*>/g) || [];
    if (hostnameTags.length > 0) {
      const hostnameAttrs = parseXmlAttributes(hostnameTags[0]);
      hostname = hostnameAttrs['name'];
    }
    
    // Validate Required Fields: Every host entry must have at least one valid address identifier
    if (!ip && !mac) {
      errors.push(`Host at index ${hostIndex} in XML is missing both IP and MAC address identifiers.`);
      hostIndex++;
      continue;
    }

    // Validate IP format if present
    if (ip) {
      const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      const ipv6Regex = /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/;
      if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
        errors.push(`Host at index ${hostIndex} in XML has an invalid IP address format: "${ip}".`);
        hostIndex++;
        continue;
      }
    }

    // Validate MAC format if present
    if (mac) {
      const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
      if (!macRegex.test(mac)) {
        errors.push(`Host at index ${hostIndex} (${ip || 'no-ip'}) in XML has an invalid MAC address format: "${mac}".`);
        hostIndex++;
        continue;
      }
    }

    // Ports & Services
    const ports: DiscoveredService[] = [];
    const portRegex = /<port\s+[^>]*>[\s\S]*?<\/port>/g;
    let portBlockMatch;
    while ((portBlockMatch = portRegex.exec(hostBlock)) !== null) {
      const portBlock = portBlockMatch[0];
      const portTag = portBlock.match(/<port\s+[^>]*>/)?.[0] || '';
      const portAttrs = parseXmlAttributes(portTag);
      const protocol = portAttrs['protocol'] || 'tcp';
      const portIdStr = portAttrs['portid'];
      const portId = parseInt(portIdStr, 10);
      
      // Validate strict typing for ports: port numbers must be integers within the range of 1-65535
      if (isNaN(portId) || portId < 1 || portId > 65535 || !Number.isInteger(portId)) {
        errors.push(`Host "${ip || mac}" in XML has an invalid port: "${portIdStr}". Port must be an integer between 1 and 65535.`);
        continue;
      }

      // Check state (only add open ports)
      const stateTag = portBlock.match(/<state\s+[^>]*>/)?.[0] || '';
      const stateAttrs = parseXmlAttributes(stateTag);
      const portState = stateAttrs['state'] || '';
      if (portState !== 'open') continue;
      
      // Service details
      const serviceTag = portBlock.match(/<service\s+[^>]*>/)?.[0];
      let serviceName: string | undefined = undefined;
      let serviceVersion: string | undefined = undefined;
      if (serviceTag) {
        const serviceAttrs = parseXmlAttributes(serviceTag);
        serviceName = serviceAttrs['name'];
        const product = serviceAttrs['product'] || '';
        const version = serviceAttrs['version'] || '';
        serviceVersion = [product, version].filter(Boolean).join(' ');
      }

      // Sanitization: Strip non-printable ASCII characters
      const sanitizedName = serviceName ? sanitizeString(serviceName) : undefined;
      const sanitizedVersion = serviceVersion ? sanitizeString(serviceVersion) : undefined;

      ports.push({
        port: portId,
        protocol: protocol.toLowerCase(),
        serviceName: sanitizedName,
        serviceVersion: sanitizedVersion,
      });
    }
    
    hosts.push({
      ip: ip || '',
      mac,
      vendor,
      hostname,
      status,
      ports,
    });

    hostIndex++;
  }
  
  return { hosts, errors };
}

/**
 * Parses Nmap JSON or standardized auto-discovery JSON payload.
 */
export function parseNmapJson(jsonContent: string): { hosts: DiscoveredHost[]; errors: string[] } {
  const errors: string[] = [];
  const hosts: DiscoveredHost[] = [];

  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch (err: any) {
    return { hosts: [], errors: [`Invalid JSON syntax: ${err.message}`] };
  }

  // Handle various potential JSON shapes
  let rawHosts: any[] = [];
  if (Array.isArray(data)) {
    rawHosts = data;
  } else if (data.hosts && Array.isArray(data.hosts)) {
    rawHosts = data.hosts;
  } else if (data.nmaprun) {
    // Converted XML structure from standard tools
    const hostData = data.nmaprun.host;
    if (hostData) {
      rawHosts = Array.isArray(hostData) ? hostData : [hostData];
    }
  } else {
    // Single host object or fallback array search
    const values = Object.values(data);
    const arrayVal = values.find(v => Array.isArray(v));
    if (arrayVal) {
      rawHosts = arrayVal as any[];
    } else {
      rawHosts = [data];
    }
  }

  for (let i = 0; i < rawHosts.length; i++) {
    const rawHost = rawHosts[i];
    if (!rawHost || typeof rawHost !== 'object') continue;

    let ip: string | undefined = undefined;
    let mac: string | undefined = undefined;
    let vendor: string | undefined = undefined;
    let hostname: string | undefined = undefined;
    let status: string = 'up';
    let rawPorts: any[] = [];

    // Extract status (handle converted XML / raw state)
    if (rawHost.status) {
      const st = rawHost.status.state || rawHost.status._attributes?.state || rawHost.status.$?.state || rawHost.status;
      if (typeof st === 'string') status = st;
    } else if (rawHost.state) {
      status = rawHost.state;
    }

    if (status !== 'up') continue;

    // Converted XML address mapping
    if (rawHost.address) {
      const addresses = Array.isArray(rawHost.address) ? rawHost.address : [rawHost.address];
      for (const addr of addresses) {
        const attributes = addr._attributes || addr.$ || addr;
        const type = attributes.addrtype || attributes.type;
        const addressVal = attributes.addr || attributes.address;
        const vend = attributes.vendor;

        if (type === 'ipv4' || type === 'ipv6') {
          ip = addressVal;
        } else if (type === 'mac') {
          mac = addressVal;
          if (vend) vendor = vend;
        }
      }
    }

    // Standard/Custom JSON mappings
    if (!ip) {
      ip = rawHost.ip || rawHost.ipAddress || rawHost.ip_address || rawHost.address;
      if (typeof ip !== 'string') ip = undefined;
    }
    if (!mac) {
      mac = rawHost.mac || rawHost.macAddress || rawHost.mac_address;
      if (typeof mac !== 'string') mac = undefined;
    }
    if (!vendor) {
      vendor = rawHost.vendor || rawHost.manufacturer;
      if (typeof vendor !== 'string') vendor = undefined;
    }
    if (!hostname) {
      hostname = rawHost.hostname || rawHost.name;
      if (typeof hostname !== 'string') hostname = undefined;
    }

    // Converted XML hostnames mapping
    if (!hostname && rawHost.hostnames) {
      const hostnames = rawHost.hostnames.hostname;
      if (hostnames) {
        const names = Array.isArray(hostnames) ? hostnames : [hostnames];
        const nameAttr = names[0]._attributes || names[0].$ || names[0];
        hostname = nameAttr.name;
      }
    }

    // Validate Required Fields: Every host entry must have at least one valid address identifier
    if (!ip && !mac) {
      errors.push(`Host at index ${i} in JSON is missing both IP and MAC address identifiers.`);
      continue;
    }

    // Validate IP format if present
    if (ip) {
      const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      const ipv6Regex = /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/;
      if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
        errors.push(`Host at index ${i} in JSON has an invalid IP address format: "${ip}".`);
        continue;
      }
    }

    // Validate MAC format if present
    if (mac) {
      const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
      if (!macRegex.test(mac)) {
        errors.push(`Host at index ${i} (${ip || 'no-ip'}) in JSON has an invalid MAC address format: "${mac}".`);
        continue;
      }
    }

    // Extract ports
    if (rawHost.ports) {
      const portsSection = rawHost.ports.port || rawHost.ports;
      if (portsSection) {
        rawPorts = Array.isArray(portsSection) ? portsSection : [portsSection];
      }
    } else if (rawHost.services && Array.isArray(rawHost.services)) {
      rawPorts = rawHost.services;
    }

    const parsedPorts: DiscoveredService[] = [];
    for (let p = 0; p < rawPorts.length; p++) {
      const rawPort = rawPorts[p];
      if (!rawPort) continue;

      const attributes = rawPort._attributes || rawPort.$ || rawPort;
      
      const portIdVal = attributes.portid || attributes.port || attributes.portId;
      const portId = typeof portIdVal === 'number' ? portIdVal : parseInt(portIdVal, 10);
      
      // Validate strict typing for ports: port numbers must be integers within the range of 1-65535
      if (isNaN(portId) || portId < 1 || portId > 65535 || !Number.isInteger(portId)) {
        errors.push(`Host "${ip || mac}" has an invalid port: "${portIdVal}". Port must be an integer between 1 and 65535.`);
        continue;
      }

      let state = 'open';
      if (rawPort.state) {
        state = rawPort.state.state || rawPort.state._attributes?.state || rawPort.state.$?.state || rawPort.state;
      }
      if (state !== 'open') continue;

      const protocol = attributes.protocol || 'tcp';

      let serviceName: string | undefined = undefined;
      let serviceVersion: string | undefined = undefined;

      if (rawPort.service) {
        const svcAttr = rawPort.service._attributes || rawPort.service.$ || rawPort.service;
        serviceName = svcAttr.name || rawPort.service.name || rawPort.service.serviceName || rawPort.service.service;
        
        const product = svcAttr.product || rawPort.service.product || '';
        const version = svcAttr.version || rawPort.service.version || rawPort.service.serviceVersion || '';
        serviceVersion = [product, version].filter(Boolean).join(' ');
      } else {
        serviceName = rawPort.serviceName || rawPort.service || rawPort.name;
        serviceVersion = rawPort.serviceVersion || rawPort.version;
      }

      // Sanitization: Strip non-printable ASCII characters
      const sanitizedName = serviceName ? sanitizeString(serviceName) : undefined;
      const sanitizedVersion = serviceVersion ? sanitizeString(serviceVersion) : undefined;

      parsedPorts.push({
        port: portId,
        protocol: String(protocol).toLowerCase(),
        serviceName: sanitizedName,
        serviceVersion: sanitizedVersion,
      });
    }

    hosts.push({
      ip: ip || '',
      mac,
      vendor,
      hostname,
      status,
      ports: parsedPorts,
    });
  }

  return { hosts, errors };
}

/**
 * Validates the raw payload string based on content type or structural check.
 */
export function validateNmapData(
  payload: string,
  contentType: string = ''
): { valid: boolean; errors: string[]; hosts: DiscoveredHost[] } {
  const trimmed = payload.trim();
  if (!trimmed) {
    return { valid: false, errors: ['Empty payload supplied'], hosts: [] };
  }

  // Detect format
  const isXml = contentType.includes('xml') || trimmed.startsWith('<');
  
  if (isXml) {
    const { hosts, errors } = parseNmapXml(trimmed);
    return {
      valid: errors.length === 0 && hosts.length > 0,
      errors: hosts.length === 0 && errors.length === 0 ? ['No hosts found in Nmap XML payload'] : errors,
      hosts,
    };
  } else {
    const { hosts, errors } = parseNmapJson(trimmed);
    return {
      valid: errors.length === 0 && hosts.length > 0,
      errors: hosts.length === 0 && errors.length === 0 ? ['No hosts found in Nmap JSON payload'] : errors,
      hosts,
    };
  }
}
