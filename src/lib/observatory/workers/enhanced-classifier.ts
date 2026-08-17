/**
 * Enhanced Device Classifier
 *
 * Automatically classifies discovered network devices based on:
 * - Open ports and services
 * - Hostname patterns
 * - MAC vendor (OUI lookup)
 * - OS fingerprinting
 * - Network behavior
 *
 * Classifications:
 * - router/gateway: Network edge devices
 * - switch: Layer 2 switching equipment
 * - server: General-purpose servers
 * - nas: Network-attached storage
 * - printer: Network printers
 * - iot: IoT devices (cameras, sensors, smart home)
 * - workstation: End-user computers
 * - docker-host: Systems running Docker
 * - docker-container: Individual containers
 * - mobile: Phones, tablets
 * - unknown: Could not classify
 */

export interface ClassificationInput {
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  openPorts: number[];
  services: Array<{ port: number; service: string; version?: string }>;
  osGuess?: string;
}

export interface Classification {
  deviceType: string;
  confidence: number; // 0.0 - 1.0
  reasoning: string[];
}

/**
 * Enhanced device classification with confidence scoring
 */
export function classifyDevice(input: ClassificationInput): Classification {
  const reasoning: string[] = [];
  let deviceType = "unknown";
  let confidence = 0.0;

  // Helper: Check if port is open
  const hasPort = (port: number) => input.openPorts.includes(port);

  // Helper: Check if service name matches
  const hasService = (name: string) =>
    input.services.some(s => s.service.toLowerCase().includes(name.toLowerCase()));

  const hostname = (input.hostname || "").toLowerCase();
  const vendor = (input.vendor || "").toLowerCase();
  const os = (input.osGuess || "").toLowerCase();
  const ip = input.ip;

  // Rule 1: Router/Gateway detection (HIGH confidence)
  if (
    ip.endsWith(".1") ||
    hostname.includes("router") ||
    hostname.includes("gateway") ||
    hostname === "_gateway" ||
    vendor.includes("cisco") ||
    vendor.includes("ubiquiti") ||
    vendor.includes("mikrotik") ||
    vendor.includes("netgear") ||
    vendor.includes("tp-link") ||
    vendor.includes("d-link") ||
    vendor.includes("asus rt")
  ) {
    deviceType = "router";
    confidence = 0.95;
    reasoning.push("IP ends with .1 or hostname/vendor indicates router");

    if (hostname.includes("gateway")) {
      deviceType = "gateway";
      reasoning.push("Hostname explicitly contains 'gateway'");
    }

    return { deviceType, confidence, reasoning };
  }

  // Rule 2: Switch detection (HIGH confidence)
  if (
    hostname.includes("switch") ||
    vendor.includes("cisco catalyst") ||
    vendor.includes("juniper") ||
    (hasPort(23) && !hasPort(80) && !hasPort(443)) // Telnet but no web interface
  ) {
    deviceType = "switch";
    confidence = 0.85;
    reasoning.push("Hostname or vendor indicates network switch");
    return { deviceType, confidence, reasoning };
  }

  // Rule 3: NAS detection (HIGH confidence)
  if (
    hostname.includes("nas") ||
    hostname.includes("storage") ||
    hostname.includes("synology") ||
    hostname.includes("qnap") ||
    hostname.includes("freenas") ||
    hostname.includes("truenas") ||
    vendor.includes("synology") ||
    vendor.includes("qnap") ||
    vendor.includes("western digital") ||
    (hasPort(445) && hasPort(139)) || // SMB ports
    (hasPort(2049)) || // NFS
    (hasPort(5000) || hasPort(5001)) // Synology DSM
  ) {
    deviceType = "nas";
    confidence = 0.9;
    reasoning.push("Hostname/vendor indicates NAS or SMB/NFS services detected");
    return { deviceType, confidence, reasoning };
  }

  // Rule 4: Printer detection (HIGH confidence)
  if (
    hostname.includes("printer") ||
    hostname.includes("hp-") ||
    hostname.includes("canon") ||
    hostname.includes("epson") ||
    vendor.includes("hp") ||
    vendor.includes("canon") ||
    vendor.includes("epson") ||
    vendor.includes("brother") ||
    hasPort(9100) || // JetDirect
    hasPort(631) || // IPP
    hasService("ipp") ||
    hasService("printer")
  ) {
    deviceType = "printer";
    confidence = 0.95;
    reasoning.push("Printer-specific ports (9100, 631) or vendor detected");
    return { deviceType, confidence, reasoning };
  }

  // Rule 5: Docker host detection (HIGH confidence)
  if (
    hasPort(2375) ||
    hasPort(2376) ||
    hasPort(2377) ||
    hasService("docker") ||
    hostname.includes("docker")
  ) {
    deviceType = "docker-host";
    confidence = 0.9;
    reasoning.push("Docker API ports detected");
    return { deviceType, confidence, reasoning };
  }

  // Rule 6: IoT device detection (MEDIUM confidence)
  if (
    hostname.includes("pi") ||
    hostname.includes("raspberry") ||
    hostname.includes("arduino") ||
    hostname.includes("esp") ||
    hostname.includes("camera") ||
    hostname.includes("sensor") ||
    hostname.includes("philips-hue") ||
    hostname.includes("ring-") ||
    hostname.includes("nest-") ||
    hostname.includes("alexa") ||
    vendor.includes("raspberry pi") ||
    vendor.includes("espressif") ||
    vendor.includes("shenzhen") ||
    (hasPort(8080) && input.openPorts.length < 3) // Single-purpose web interface
  ) {
    deviceType = "iot";
    confidence = 0.75;
    reasoning.push("IoT-specific hostname or vendor pattern");

    // Refine if it's clearly a Raspberry Pi server
    if ((hostname.includes("pi") || vendor.includes("raspberry")) && input.openPorts.length > 5) {
      deviceType = "server";
      confidence = 0.8;
      reasoning.push("Raspberry Pi with many open ports - likely used as server");
    }

    return { deviceType, confidence, reasoning };
  }

  // Rule 7: Server detection (MEDIUM-HIGH confidence)
  if (
    hasPort(22) || // SSH
    hasPort(3306) || // MySQL
    hasPort(5432) || // PostgreSQL
    hasPort(6379) || // Redis
    hasPort(27017) || // MongoDB
    hasService("ssh") ||
    hasService("mysql") ||
    hasService("postgresql") ||
    hasService("redis") ||
    os.includes("linux") ||
    os.includes("ubuntu") ||
    os.includes("debian") ||
    os.includes("centos") ||
    hostname.includes("server") ||
    hostname.includes("host") ||
    input.openPorts.length > 5 // Many open ports suggests server
  ) {
    deviceType = "server";
    confidence = 0.8;
    reasoning.push("SSH and/or database ports detected");

    // Refine for web servers
    if ((hasPort(80) || hasPort(443)) && (hasPort(22))) {
      reasoning.push("HTTP/HTTPS + SSH suggests web server");
      confidence = 0.85;
    }

    return { deviceType, confidence, reasoning };
  }

  // Rule 8: Mobile device detection (MEDIUM confidence)
  if (
    vendor.includes("apple") ||
    vendor.includes("samsung") ||
    vendor.includes("lg electronics") ||
    vendor.includes("htc") ||
    vendor.includes("motorola mobility") ||
    hostname.includes("iphone") ||
    hostname.includes("ipad") ||
    hostname.includes("android") ||
    hostname.includes("samsung-galaxy")
  ) {
    deviceType = "mobile";
    confidence = 0.7;
    reasoning.push("Mobile device vendor or hostname pattern");
    return { deviceType, confidence, reasoning };
  }

  // Rule 9: Workstation detection (LOW-MEDIUM confidence)
  if (
    os.includes("windows") ||
    os.includes("macos") ||
    os.includes("mac os") ||
    vendor.includes("apple") ||
    vendor.includes("dell") ||
    vendor.includes("lenovo") ||
    vendor.includes("hp") ||
    hostname.includes("macbook") ||
    hostname.includes("imac") ||
    hostname.includes("desktop") ||
    hostname.includes("laptop") ||
    (hasPort(445) && hasPort(135)) || // Windows SMB + RPC
    input.openPorts.length >= 1 && input.openPorts.length <= 4
  ) {
    deviceType = "workstation";
    confidence = 0.6;
    reasoning.push("Desktop OS or workstation vendor detected");
    return { deviceType, confidence, reasoning };
  }

  // Rule 10: Default fallback
  if (input.openPorts.length === 0) {
    deviceType = "unknown";
    confidence = 0.1;
    reasoning.push("No open ports detected - device may be offline or filtered");
  } else {
    deviceType = "unknown";
    confidence = 0.3;
    reasoning.push(`Could not classify: ${input.openPorts.length} open ports but no clear pattern`);
  }

  return { deviceType, confidence, reasoning };
}

/**
 * Batch classify multiple devices
 */
export function classifyDevices(devices: ClassificationInput[]): Classification[] {
  return devices.map(device => classifyDevice(device));
}

/**
 * Get human-readable device type label
 */
export function getDeviceTypeLabel(deviceType: string): string {
  const labels: Record<string, string> = {
    "router": "Router",
    "gateway": "Gateway",
    "switch": "Network Switch",
    "server": "Server",
    "nas": "Network Storage (NAS)",
    "printer": "Printer",
    "iot": "IoT Device",
    "workstation": "Workstation",
    "docker-host": "Docker Host",
    "docker-container": "Container",
    "mobile": "Mobile Device",
    "unknown": "Unknown Device",
  };

  return labels[deviceType] || deviceType;
}

/**
 * Get icon/emoji for device type
 */
export function getDeviceIcon(deviceType: string): string {
  const icons: Record<string, string> = {
    "router": "🌐",
    "gateway": "🚪",
    "switch": "🔀",
    "server": "🖥️",
    "nas": "💾",
    "printer": "🖨️",
    "iot": "📡",
    "workstation": "💻",
    "docker-host": "🐋",
    "docker-container": "📦",
    "mobile": "📱",
    "unknown": "❓",
  };

  return icons[deviceType] || "🔧";
}
