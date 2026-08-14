/**
 * Auto-Stack Creator
 * Organizes discovered devices into logical stacks
 */

export interface StackDefinition {
  id: string;
  name: string;
  description: string;
  deviceIds: string[];
}

/**
 * Create automatic stacks from discovered devices
 */
export async function createAutoStacks(devices: Array<{
  id: string;
  ip: string;
  hostname?: string;
  deviceType?: string;
  deviceClassification?: string;
  services?: Array<{ service: string }>;
}>): Promise<StackDefinition[]> {
  
  const stacks: StackDefinition[] = [];
  
  // 1. Docker Containers Stack
  const dockerContainers = devices.filter(d => d.id.startsWith("docker-"));
  if (dockerContainers.length > 0) {
    stacks.push({
      id: "stack-docker-containers",
      name: "Docker Containers",
      description: `${dockerContainers.length} containerized services`,
      deviceIds: dockerContainers.map(d => d.id),
    });
  }
  
  // 2. Network Infrastructure Stack (routers, switches, gateway)
  const infrastructure = devices.filter(d => 
    d.deviceClassification === "router" ||
    d.deviceClassification === "switch" ||
    d.deviceClassification === "gateway" ||
    d.hostname?.toLowerCase().includes("gateway") ||
    d.hostname?.toLowerCase().includes("router") ||
    d.ip.endsWith(".1")  // Common gateway pattern
  );
  if (infrastructure.length > 0) {
    stacks.push({
      id: "stack-network-infrastructure",
      name: "Network Infrastructure",
      description: `${infrastructure.length} network devices (routers, switches)`,
      deviceIds: infrastructure.map(d => d.id),
    });
  }
  
  // 3. Servers Stack (high service count, specific types)
  const servers = devices.filter(d => 
    !d.id.startsWith("docker-") &&
    (
      d.deviceClassification === "server" ||
      d.deviceClassification === "nas" ||
      d.deviceClassification === "docker-host" ||
      (d.services && d.services.length > 3)
    )
  );
  if (servers.length > 0) {
    stacks.push({
      id: "stack-servers",
      name: "Servers & Storage",
      description: `${servers.length} servers (NAS, hosts, databases)`,
      deviceIds: servers.map(d => d.id),
    });
  }
  
  // 4. Workstations Stack
  const workstations = devices.filter(d =>
    !d.id.startsWith("docker-") &&
    d.deviceClassification === "workstation"
  );
  if (workstations.length > 0) {
    stacks.push({
      id: "stack-workstations",
      name: "Workstations",
      description: `${workstations.length} desktop/laptop computers`,
      deviceIds: workstations.map(d => d.id),
    });
  }
  
  // 5. IoT Devices Stack
  const iot = devices.filter(d =>
    d.deviceClassification === "iot" ||
    d.hostname?.toLowerCase().includes("pi") ||
    d.hostname?.toLowerCase().includes("esp")
  );
  if (iot.length > 0) {
    stacks.push({
      id: "stack-iot",
      name: "IoT Devices",
      description: `${iot.length} IoT devices (Pi, smart home, sensors)`,
      deviceIds: iot.map(d => d.id),
    });
  }
  
  // 6. Web Services Stack (HTTP/HTTPS)
  const webServices = devices.filter(d =>
    !d.id.startsWith("docker-") &&
    d.services?.some(s => 
      s.service.toLowerCase().includes("http") ||
      s.service.toLowerCase().includes("nginx") ||
      s.service.toLowerCase().includes("apache")
    )
  );
  if (webServices.length > 0) {
    stacks.push({
      id: "stack-web-services",
      name: "Web Services",
      description: `${webServices.length} HTTP/HTTPS services`,
      deviceIds: webServices.map(d => d.id),
    });
  }
  
  // 7. Uncategorized (devices that didn't fit above)
  const categorizedIds = new Set(stacks.flatMap(s => s.deviceIds));
  const uncategorized = devices.filter(d => !categorizedIds.has(d.id));
  if (uncategorized.length > 0) {
    stacks.push({
      id: "stack-uncategorized",
      name: "Other Devices",
      description: `${uncategorized.length} devices awaiting classification`,
      deviceIds: uncategorized.map(d => d.id),
    });
  }
  
  return stacks;
}

/**
 * Save stacks to database
 */
export async function saveStacks(stacks: StackDefinition[], userId: string): Promise<number> {
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  let saved = 0;
  
  for (const stack of stacks) {
    try {
      const now = Date.now();
      
      // Insert or update stack
      const stmt = rawDb.prepare(`
        INSERT INTO stacks (id, name, description, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          updated_at = excluded.updated_at
      `);
      
      stmt.run(stack.id, stack.name, stack.description, userId, now, now);
      
      // Update discovered_hosts with stack_id
      const updateStmt = rawDb.prepare(`
        UPDATE discovered_hosts SET stack_id = ? WHERE id = ?
      `);
      
      for (const deviceId of stack.deviceIds) {
        updateStmt.run(stack.id, deviceId);
      }
      
      saved++;
      console.log(`[Stack Creator]   ✓ Created stack: ${stack.name} (${stack.deviceIds.length} devices)`);
    } catch (error) {
      console.error(`[Stack Creator]   ✗ Failed to create stack ${stack.name}:`, error.message);
    }
  }
  
  return saved;
}
