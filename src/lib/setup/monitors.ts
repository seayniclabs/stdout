/**
 * Monitor Auto-Configuration
 *
 * Creates monitors for discovered data sources and stacks
 */

import type { StepResult } from './installer';

interface MonitorTemplate {
  type: string;
  name: string;
  checkInterval: number;
  thresholds: {
    warning: number;
    critical: number;
  };
  query?: string;
}

/**
 * Auto-configure monitors for discovered stacks and data sources
 */
export async function configureMonitors(
  userId: string,
  onProgress: (progress: number, message: string) => void
): Promise<StepResult> {
  const startTime = Date.now();
  const output: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let monitorsCreated = 0;

  try {
    const { getDb } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const { nanoid } = await import('nanoid');
    const db = getDb();

    onProgress(5, 'Riggins is analyzing your environment...');

    // Get all stacks
    let stacks = await db.all(sql`
      SELECT id, name FROM stacks WHERE user_id = ${userId}
    `) as Array<{ id: string; name: string }>;

    output.push(`Found ${stacks.length} existing stacks`);

    // Create default stacks if none exist
    if (stacks.length === 0) {
      onProgress(10, 'Riggins is creating your infrastructure stacks...');
      const now = Date.now();

      const defaultStacks = [
        {
          name: 'Production Services',
          description: 'Core production infrastructure and services',
          tags: JSON.stringify(['production', 'core'])
        },
        {
          name: 'Monitoring & Observatory',
          description: 'StdOut, Windlass, and Observatory services',
          tags: JSON.stringify(['monitoring', 'observatory'])
        }
      ];

      for (const stackDef of defaultStacks) {
        const stackId = nanoid();
        await db.run(sql`
          INSERT INTO stacks (id, user_id, name, description, tags, created_at, updated_at)
          VALUES (${stackId}, ${userId}, ${stackDef.name}, ${stackDef.description}, ${stackDef.tags}, ${now}, ${now})
        `);
        output.push(`✓ Created stack: ${stackDef.name}`);
      }

      // Reload stacks
      stacks = await db.all(sql`
        SELECT id, name FROM stacks WHERE user_id = ${userId}
      `) as Array<{ id: string; name: string }>;
    }

    onProgress(30, 'Riggins is scanning your network for devices and services...');

    // Run comprehensive network discovery
    const { scanNetwork } = await import('../discovery/network-scanner');
    const discoveredDevices = await scanNetwork({
      arpScan: true,
      mdnsScan: true,
      ssdpScan: true,
      vendorLookup: true,
      timeout: 10
    });

    output.push(`✓ Network scan complete: found ${discoveredDevices.length} devices`);
    onProgress(50, `Found ${discoveredDevices.length} devices on your network...`);

    // Save discovered devices to database
    for (const device of discoveredDevices) {
      try {
        const deviceId = nanoid();
        const now = Date.now();

        await db.run(sql`
          INSERT INTO discovered_hosts (
            id, ip_address, mac_address, hostname, device_type, vendor,
            os_guess, last_seen_at, first_seen_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          deviceId,
          device.ip,
          device.mac || null,
          device.hostname || null,
          device.deviceType || 'unknown',
          device.vendor || null,
          device.os || null,
          now,
          now,
          now
        ]);

        // Save discovered services for this device
        for (const service of device.services || []) {
          const serviceId = nanoid();
          await db.run(sql`
            INSERT INTO discovered_services (
              id, host_id, name, port, protocol, type, description,
              discovered_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            serviceId,
            deviceId,
            service.name || 'Unknown Service',
            service.port || null,
            service.protocol || 'tcp',
            service.type || 'unknown',
            service.description || null,
            now,
            now
          ]);
        }
      } catch (error) {
        warnings.push(`Failed to save device ${device.ip}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    onProgress(70, 'Creating monitors for discovered services...');

    // Create monitors for discovered HTTP services
    const initialMonitors = [
      {
        stackName: 'Monitoring & Observatory',
        name: 'StdOut Health',
        type: 'http',
        target: 'http://localhost:3000/',
        interval: 60,
        description: 'StdOut application health'
      }
    ];

    // Auto-create monitors for discovered HTTP services
    for (const device of discoveredDevices) {
      if (!device.services) continue;

      for (const service of device.services) {
        // Create HTTP monitors for web services
        if (service.type === 'http' || service.port === 80 || service.port === 443 || service.port === 8080) {
          const protocol = service.port === 443 ? 'https' : 'http';
          initialMonitors.push({
            stackName: 'Production Services',
            name: `${device.hostname || device.ip} (${service.name || 'HTTP'})`,
            type: 'http',
            target: `${protocol}://${device.ip}:${service.port || 80}`,
            interval: 300,
            description: `Auto-discovered HTTP service on ${device.hostname || device.ip}`
          });
        }
        // Create TCP monitors for other services
        else if (service.port) {
          initialMonitors.push({
            stackName: 'Production Services',
            name: `${device.hostname || device.ip}:${service.port} (${service.name || 'TCP'})`,
            type: 'tcp',
            target: `${device.ip}:${service.port}`,
            interval: 300,
            description: `Auto-discovered service on ${device.hostname || device.ip}`
          });
        }
      }
    }

    onProgress(50, 'Creating monitors...');

    const progressPerMonitor = 40 / initialMonitors.length;
    let currentProgress = 50;

    for (const monitorDef of initialMonitors) {
      try {
        // Find the stack
        const stack = stacks.find(s => s.name === monitorDef.stackName);
        if (!stack) {
          warnings.push(`Stack not found: ${monitorDef.stackName}`);
          continue;
        }

        // Check if monitor already exists
        const existing = await db.get(sql`
          SELECT id FROM monitors
          WHERE name = ${monitorDef.name}
          AND user_id = ${userId}
        `);

        if (existing) {
          output.push(`○ Monitor already exists: ${monitorDef.name}`);
          continue;
        }

        // Create monitor
        const monitorId = nanoid();
        const now = Date.now();

        await db.run(sql`
          INSERT INTO monitors (
            id,
            user_id,
            stack_id,
            name,
            type,
            target,
            interval_seconds,
            paused,
            current_status,
            consecutive_failures,
            created_at,
            updated_at
          ) VALUES (
            ${monitorId},
            ${userId},
            ${stack.id},
            ${monitorDef.name},
            ${monitorDef.type},
            ${monitorDef.target},
            ${monitorDef.interval},
            0,
            'unknown',
            0,
            ${now},
            ${now}
          )
        `);

        monitorsCreated++;
        output.push(`✓ Created monitor: ${monitorDef.name}`);

      } catch (error: unknown) {
        warnings.push(`Failed to create monitor ${monitorDef.name}: ${error instanceof Error ? error.message : String(error)}`);
      }

      currentProgress += progressPerMonitor;
      onProgress(Math.round(currentProgress), `Setting up ${monitorDef.name}...`);
    }

    onProgress(95, `Riggins has configured ${monitorsCreated} monitors`);

    // Create a welcome incident from Riggins
    try {
      const incidentId = nanoid();
      const now = Date.now();

      const welcomeMessage = `I've just finished setting up your monitoring infrastructure. I scanned your network and discovered ${discoveredDevices.length} devices, then created ${monitorsCreated} monitors to watch your services.

**What I found:**
- ${discoveredDevices.length} devices on your network
- ${discoveredDevices.filter(d => d.services && d.services.length > 0).length} devices with active services
- ${monitorsCreated} monitors configured and running

**What I'm watching:**
${initialMonitors.slice(0, 5).map(m => `- ${m.name} (every ${m.interval}s)`).join('\n')}
${initialMonitors.length > 5 ? `\n...and ${initialMonitors.length - 5} more monitors` : ''}

**What I can do:**
- Detect anomalies automatically (I check every 3 minutes)
- Diagnose incidents when they occur
- Learn from your resolutions to get smarter over time

**Next steps:**
- Check the Infrastructure tab to see all your devices and services
- Visit the Observatory tab to see what I'm learning about your environment
- Create a test incident and click 'Get AI Diagnosis' to see my analysis

I'm here 24/7, learning and watching. Let's keep your systems running smoothly together.`;

      await db.run(sql`
        INSERT INTO incidents (
          id,
          user_id,
          stack_id,
          title,
          description,
          severity,
          status,
          created_at,
          updated_at
        ) VALUES (
          ${incidentId},
          ${userId},
          ${stacks[0]?.id || null},
          ${"Hello! I'm Riggins, your Observatory AI"},
          ${welcomeMessage},
          ${"low"},
          ${"active"},
          ${now},
          ${now}
        )
      `);

      output.push("✓ Riggins says hello!");
    } catch {
      // Non-fatal if welcome message fails
    }

    onProgress(100, `Setup complete - Riggins is ready!`);

    return {
      success: true,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };

  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      success: false,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };
  }
}

/**
 * Get recommended monitors for a stack type
 */
export function getRecommendedMonitors(stackType: string): MonitorTemplate[] {
  const base: MonitorTemplate[] = [
    {
      type: 'health',
      name: 'Container Health',
      checkInterval: 300,
      thresholds: { warning: 1, critical: 1 }
    },
    {
      type: 'cpu',
      name: 'CPU Usage',
      checkInterval: 300,
      thresholds: { warning: 70, critical: 90 }
    },
    {
      type: 'memory',
      name: 'Memory Usage',
      checkInterval: 300,
      thresholds: { warning: 80, critical: 95 }
    }
  ];

  // Type-specific monitors
  const typeSpecific: Record<string, MonitorTemplate[]> = {
    database: [
      {
        type: 'connections',
        name: 'Active Connections',
        checkInterval: 300,
        thresholds: { warning: 80, critical: 95 }
      },
      {
        type: 'storage',
        name: 'Storage Usage',
        checkInterval: 600,
        thresholds: { warning: 80, critical: 90 }
      }
    ],
    web: [
      {
        type: 'response_time',
        name: 'Response Time',
        checkInterval: 180,
        thresholds: { warning: 1000, critical: 3000 }
      },
      {
        type: 'error_rate',
        name: 'Error Rate',
        checkInterval: 300,
        thresholds: { warning: 5, critical: 10 }
      }
    ],
    cache: [
      {
        type: 'hit_rate',
        name: 'Cache Hit Rate',
        checkInterval: 300,
        thresholds: { warning: 70, critical: 50 }
      },
      {
        type: 'evictions',
        name: 'Eviction Rate',
        checkInterval: 300,
        thresholds: { warning: 100, critical: 500 }
      }
    ]
  };

  return [...base, ...(typeSpecific[stackType] || [])];
}
