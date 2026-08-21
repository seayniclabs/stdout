/**
 * Connection Handler
 *
 * Attempts to auto-connect to discovered services
 * Follows Home Assistant pattern: try no-auth first, then common defaults
 */

import type { IntegrationType } from './integration-detector';

export interface ConnectionResult {
  success: boolean;
  needsConfig: boolean;
  error?: string;
  config?: Record<string, any>;
}

/**
 * Attempt to connect to a discovered service
 */
export async function attemptConnection(
  ipAddress: string,
  integration: IntegrationType,
): Promise<ConnectionResult> {
  console.log(`[connection-handler] Attempting connection to ${integration.name} at ${ipAddress}`);

  try {
    // Route to specific handler based on integration type
    switch (integration.type) {
      case 'prometheus':
        return await connectPrometheus(ipAddress, integration.ports[0]);
      case 'grafana':
        return await connectGrafana(ipAddress, integration.ports[0]);
      case 'docker':
        return await connectDocker(ipAddress, integration.ports[0]);
      case 'mysql':
        return await connectMySQL(ipAddress, integration.ports[0]);
      case 'redis':
        return await connectRedis(ipAddress, integration.ports[0]);
      case 'http':
      case 'https':
        return await connectHTTP(ipAddress, integration.ports[0], integration.type === 'https');
      default:
        // Generic HTTP health check for unknown types
        return await connectGeneric(ipAddress, integration.ports[0]);
    }
  } catch (error) {
    console.error(`[connection-handler] Connection failed:`, error);
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Prometheus connection (no auth typically)
 */
async function connectPrometheus(ipAddress: string, port: number): Promise<ConnectionResult> {
  try {
    const response = await fetch(`http://${ipAddress}:${port}/-/ready`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        success: true,
        needsConfig: false,
        config: { url: `http://${ipAddress}:${port}` },
      };
    }

    return {
      success: false,
      needsConfig: true,
      error: `Prometheus not ready: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Grafana connection (requires auth)
 */
async function connectGrafana(ipAddress: string, port: number): Promise<ConnectionResult> {
  try {
    // Try unauthenticated health endpoint first
    const response = await fetch(`http://${ipAddress}:${port}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // Grafana is running but needs credentials for full access
      return {
        success: false,
        needsConfig: true,
        error: 'Grafana detected - credentials required for monitoring',
        config: { url: `http://${ipAddress}:${port}`, username: 'admin' },
      };
    }

    return {
      success: false,
      needsConfig: true,
      error: `Grafana health check failed: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Docker API connection
 */
async function connectDocker(ipAddress: string, port: number): Promise<ConnectionResult> {
  try {
    const response = await fetch(`http://${ipAddress}:${port}/version`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        needsConfig: false,
        config: {
          url: `http://${ipAddress}:${port}`,
          version: data.Version,
        },
      };
    }

    return {
      success: false,
      needsConfig: true,
      error: `Docker API check failed: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * MySQL connection (requires credentials)
 */
async function connectMySQL(ipAddress: string, port: number): Promise<ConnectionResult> {
  // MySQL requires credentials - can't auto-connect
  return {
    success: false,
    needsConfig: true,
    error: 'MySQL requires credentials',
    config: {
      host: ipAddress,
      port,
      username: 'root',
    },
  };
}

/**
 * Redis connection
 */
async function connectRedis(ipAddress: string, port: number): Promise<ConnectionResult> {
  // Redis auto-connection would require a Redis client
  // For now, mark as needs config
  return {
    success: false,
    needsConfig: true,
    error: 'Redis connection requires configuration',
    config: {
      host: ipAddress,
      port,
    },
  };
}

/**
 * Generic HTTP health check
 */
async function connectHTTP(ipAddress: string, port: number, https: boolean): Promise<ConnectionResult> {
  try {
    const protocol = https ? 'https' : 'http';
    const response = await fetch(`${protocol}://${ipAddress}:${port}/`, {
      signal: AbortSignal.timeout(5000),
      // Allow self-signed certs for HTTPS
      ...(https && { headers: { 'Accept': '*/*' } }),
    });

    if (response.ok || response.status === 401 || response.status === 403) {
      return {
        success: true,
        needsConfig: false,
        config: { url: `${protocol}://${ipAddress}:${port}` },
      };
    }

    return {
      success: false,
      needsConfig: true,
      error: `HTTP check failed: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generic connection attempt (TCP ping)
 */
async function connectGeneric(ipAddress: string, port: number): Promise<ConnectionResult> {
  try {
    const response = await fetch(`http://${ipAddress}:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });

    return {
      success: response.ok,
      needsConfig: !response.ok,
      error: response.ok ? undefined : `Service responded with ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      needsConfig: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
