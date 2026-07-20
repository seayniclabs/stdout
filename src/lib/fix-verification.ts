import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Fix Verification Service
 *
 * After autofix applies a command, verify it actually worked.
 * Supports verification for common fix patterns.
 */

export interface VerificationResult {
  verified: boolean;
  message: string;
  evidence?: string;
}

/**
 * Verify a fix was successfully applied.
 *
 * Analyzes the original incident and applied command to determine
 * what verification checks should run.
 */
export async function verifyFix(
  incidentTitle: string,
  incidentDescription: string,
  appliedCommand: string,
  commandOutput: string,
  commandExitCode: number
): Promise<VerificationResult> {
  // If command failed, no need to verify
  if (commandExitCode !== 0) {
    return {
      verified: false,
      message: 'Command execution failed',
      evidence: `Exit code: ${commandExitCode}`,
    };
  }

  // Pattern matching for common fix types
  const patterns = [
    {
      name: 'container_restart',
      detect: (cmd: string) => /docker (restart|stop|start|compose up)/.test(cmd),
      verify: async (cmd: string) => {
        // Extract container name
        const match = cmd.match(/docker (?:restart|stop|start) ([a-zA-Z0-9_-]+)/);
        if (!match) return { verified: false, message: 'Could not parse container name' };

        const containerName = match[1];

        try {
          const { stdout } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Status}}"`, {
            timeout: 5000,
          });

          const status = stdout.trim();
          if (status.includes('Up')) {
            return {
              verified: true,
              message: `Container ${containerName} is running`,
              evidence: status,
            };
          } else {
            return {
              verified: false,
              message: `Container ${containerName} is not running`,
              evidence: status,
            };
          }
        } catch (err) {
          return {
            verified: false,
            message: 'Failed to check container status',
            evidence: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      name: 'service_health_check',
      detect: (cmd: string) => /curl|wget|nc|telnet/.test(cmd),
      verify: async (cmd: string) => {
        // Extract URL or endpoint from command
        const urlMatch = cmd.match(/(?:curl|wget)\s+(?:-[^\s]+\s+)*([^\s]+)/);
        if (!urlMatch) return { verified: false, message: 'Could not parse endpoint from command' };

        const endpoint = urlMatch[1];

        try {
          const { stdout } = await execAsync(`curl -sf ${endpoint} -o /dev/null && echo "ok"`, {
            timeout: 10000,
          });

          if (stdout.trim() === 'ok') {
            return {
              verified: true,
              message: `Endpoint ${endpoint} is responding`,
              evidence: 'HTTP request succeeded',
            };
          } else {
            return {
              verified: false,
              message: `Endpoint ${endpoint} is not responding`,
            };
          }
        } catch (err) {
          return {
            verified: false,
            message: `Endpoint ${endpoint} is not responding`,
            evidence: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      name: 'disk_cleanup',
      detect: (cmd: string) => /rm\s|docker\s+system\s+prune|journalctl\s+--vacuum/.test(cmd),
      verify: async (cmd: string) => {
        try {
          const { stdout } = await execAsync('df -h / | tail -1', { timeout: 5000 });
          const usageMatch = stdout.match(/(\d+)%/);
          if (!usageMatch) return { verified: false, message: 'Could not parse disk usage' };

          const usagePercent = parseInt(usageMatch[1], 10);

          // If disk usage is still high (>90%), fix didn't work
          if (usagePercent > 90) {
            return {
              verified: false,
              message: `Disk usage still high: ${usagePercent}%`,
              evidence: stdout.trim(),
            };
          } else {
            return {
              verified: true,
              message: `Disk usage acceptable: ${usagePercent}%`,
              evidence: stdout.trim(),
            };
          }
        } catch (err) {
          return {
            verified: false,
            message: 'Failed to check disk usage',
            evidence: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      name: 'permission_fix',
      detect: (cmd: string) => /chmod|chown/.test(cmd),
      verify: async (cmd: string) => {
        // Extract file path
        const match = cmd.match(/(?:chmod|chown)\s+(?:\d+\s+|[a-z]+:[a-z]+\s+)(.+)/);
        if (!match) return { verified: false, message: 'Could not parse file path from command' };

        const filePath = match[1].trim();

        try {
          const { stdout } = await execAsync(`ls -la ${filePath}`, { timeout: 5000 });
          return {
            verified: true,
            message: `Permissions updated for ${filePath}`,
            evidence: stdout.trim(),
          };
        } catch (err) {
          return {
            verified: false,
            message: `File ${filePath} not accessible`,
            evidence: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
  ];

  // Find matching verification pattern
  for (const pattern of patterns) {
    if (pattern.detect(appliedCommand)) {
      return await pattern.verify(appliedCommand);
    }
  }

  // No specific verification pattern — assume success based on exit code
  return {
    verified: true,
    message: 'Command executed successfully (no specific verification available)',
    evidence: `Exit code: ${commandExitCode}`,
  };
}
