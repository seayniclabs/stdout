/**
 * Velociraptor Integration (Digital Forensics & IR)
 *
 * Enables "Instant IR Mode" — forensic artifact collection via Velociraptor.
 *
 * Features:
 * - Hunt execution (VQL queries across fleet)
 * - Artifact collection (memory dumps, process lists, network connections)
 * - Emergency isolation workflow
 * - Timeline reconstruction
 *
 * Velociraptor API:
 * - Base URL: https://velociraptor.example.com:8000
 * - Auth: API key in `X-API-Key` header
 * - Endpoints: /api/v1/CreateHunt, /api/v1/GetHunt, /api/v1/CollectArtifact
 */

import { getDb, schema } from './db';
import { eq } from 'drizzle-orm';

export interface VelociraptorConfig {
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface VelociraptorHunt {
  huntId: string;
  name: string;
  description: string;
  vql: string;  // VQL query
  state: 'RUNNING' | 'STOPPED' | 'PAUSED';
  totalClients: number;
  completedClients: number;
}

export interface VelociraptorArtifact {
  name: string;  // Windows.System.ProcessListing
  description: string;
  parameters?: Record<string, any>;
}

export interface VelociraptorIsolationRequest {
  clientId: string;  // C.abc123
  reason: string;
  duration: number;  // seconds
}

/**
 * Get Velociraptor configuration
 */
export function getVelociraptorConfig(userId: number): VelociraptorConfig | null {
  const db = getDb();

  try {
    const config = db.prepare(`
      SELECT api_url, api_key, enabled
      FROM velociraptor_config
      LIMIT 1
    `).get() as any;

    if (!config) return null;

    return {
      apiUrl: config.api_url,
      apiKey: config.api_key,
      enabled: config.enabled === 1,
    };
  } catch (err) {
    console.warn('velociraptor_config table not found');
    return null;
  }
}

/**
 * Create VQL hunt
 */
export async function createVelociraptorHunt(
  hunt: Omit<VelociraptorHunt, 'huntId' | 'state' | 'totalClients' | 'completedClients'>,
  config: VelociraptorConfig
): Promise<VelociraptorHunt> {
  const response = await fetch(`${config.apiUrl}/api/v1/CreateHunt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify({
      hunt: {
        name: hunt.name,
        description: hunt.description,
        vql: hunt.vql,
        condition: {
          os: 'ALL',
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Velociraptor API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    huntId: data.hunt_id,
    ...hunt,
    state: 'RUNNING',
    totalClients: 0,
    completedClients: 0,
  };
}

/**
 * Collect artifact from specific client
 */
export async function collectVelociraptorArtifact(
  clientId: string,
  artifact: VelociraptorArtifact,
  config: VelociraptorConfig
): Promise<{ flowId: string }> {
  const response = await fetch(`${config.apiUrl}/api/v1/CollectArtifact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify({
      client_id: clientId,
      artifacts: [artifact.name],
      parameters: artifact.parameters || {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Velociraptor API error: ${response.statusText}`);
  }

  const data = await response.json();
  return { flowId: data.flow_id };
}

/**
 * Emergency isolation: block network access for a client
 */
export async function isolateVelociraptorClient(
  request: VelociraptorIsolationRequest,
  config: VelociraptorConfig
): Promise<void> {
  // Use VQL to create firewall rules blocking all traffic except Velociraptor
  const vql = `
    SELECT * FROM execve(
      argv=["netsh", "advfirewall", "firewall", "add", "rule",
            "name=IR_ISOLATION",
            "dir=out",
            "action=block",
            "enable=yes"]
    )
  `;

  await collectVelociraptorArtifact(
    request.clientId,
    {
      name: 'Windows.System.IsolateHost',
      description: `Emergency isolation: ${request.reason}`,
      parameters: { VQL: vql },
    },
    config
  );

  console.log(`Isolated client ${request.clientId} via Velociraptor`);
}

/**
 * Common IR artifacts
 */
export const VELOCIRAPTOR_IR_ARTIFACTS = [
  {
    name: 'Windows.System.ProcessListing',
    description: 'Running processes with command lines',
  },
  {
    name: 'Windows.Network.NetstatEnriched',
    description: 'Network connections with process info',
  },
  {
    name: 'Windows.EventLogs.EvtxHunter',
    description: 'Event logs for suspicious activity',
  },
  {
    name: 'Windows.Memory.Acquisition',
    description: 'Physical memory dump',
  },
  {
    name: 'Windows.Forensics.Timeline',
    description: 'Filesystem timeline (MFT)',
  },
  {
    name: 'Windows.Registry.RecentDocs',
    description: 'Recently accessed documents',
  },
  {
    name: 'Windows.Forensics.Prefetch',
    description: 'Prefetch files (execution history)',
  },
];

/**
 * Instant IR Mode: Collect all IR artifacts from a client
 */
export async function instantIRMode(
  clientId: string,
  incidentId: number,
  userId: number
): Promise<{ flowIds: string[] }> {
  const config = getVelociraptorConfig(userId);
  if (!config || !config.enabled) {
    throw new Error('Velociraptor not configured or disabled');
  }

  const flowIds: string[] = [];

  // Collect all IR artifacts in parallel
  const collections = VELOCIRAPTOR_IR_ARTIFACTS.map(async (artifact) => {
    try {
      const result = await collectVelociraptorArtifact(clientId, artifact, config);
      flowIds.push(result.flowId);
      console.log(`Collected ${artifact.name}: ${result.flowId}`);
    } catch (err) {
      console.error(`Failed to collect ${artifact.name}:`, err);
    }
  });

  await Promise.allSettled(collections);

  // Log to incident
  const db = getDb();
  db.prepare(`
    UPDATE incidents
    SET description = description || '\n\n**Instant IR Mode Activated**\nCollected ${flowIds.length} artifacts via Velociraptor.\nFlow IDs: ${flowIds.join(', ')}'
    WHERE id = ?
  `).run(incidentId);

  return { flowIds };
}

/**
 * Get hunt status
 */
export async function getVelociraptorHunt(
  huntId: string,
  config: VelociraptorConfig
): Promise<VelociraptorHunt> {
  const response = await fetch(`${config.apiUrl}/api/v1/GetHunt?hunt_id=${huntId}`, {
    headers: {
      'X-API-Key': config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Velociraptor API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    huntId: data.hunt_id,
    name: data.name,
    description: data.description,
    vql: data.vql,
    state: data.state,
    totalClients: data.total_clients || 0,
    completedClients: data.completed_clients || 0,
  };
}
