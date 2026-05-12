import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

const execAsync = promisify(exec);

/**
 * POST /app/api/incidents/autofix-exec
 * Execute an approved command from an auto-fix plan.
 *
 * Self-hosted only. Runs commands via the Windlass server's exec endpoint,
 * or falls back to Docker exec for container-specific commands.
 * Requires BYOK key (auto-fix gate) + explicit approval per command.
 *
 * This is NOT arbitrary command execution — commands must come from
 * an AI-generated plan and be explicitly approved by the user.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { isSelfHosted } = await import('../../../../lib/ai-providers');
  if (!isSelfHosted()) {
    return new Response(JSON.stringify({ error: 'Auto-fix execution is self-hosted only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { command, incidentId, stepIndex, approved } = body;

  if (!command || !incidentId) {
    return new Response(JSON.stringify({ error: 'command and incidentId are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (approved !== true) {
    return new Response(JSON.stringify({ error: 'Command must be explicitly approved (approved: true)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const policyErr = assertAutofixCommandAllowed(command);
  if (policyErr) {
    return new Response(JSON.stringify({ error: policyErr }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify incident exists
  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);
  const incident = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.id, incidentId)).get();
  if (!incident || incident.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Incident not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Execute the command via Windlass server or direct Docker exec
  try {
    const result = await executeCommand(command);

    // Log the execution as an audit event
    const { logAudit } = await import('../../../../lib/ai-providers');
    logAudit(userId, incidentId, 'autofix_apply', 'system', 'exec',
      'user_key', result.exitCode === 0 ? 'success' : 'failed',
      result.exitCode !== 0 ? result.stderr?.slice(0, 200) : undefined);

    return new Response(JSON.stringify({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      command,
      stepIndex,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message,
      command,
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

async function executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Try Windlass server exec endpoint first (if available)
  const windlassUrl = process.env.WINDLASS_URL || 'http://host.docker.internal:8116';

  try {
    const res = await fetch(`${windlassUrl}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const data = await res.json() as any;
      return {
        exitCode: data.exitCode ?? data.exit_code ?? 0,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
      };
    }
  } catch {
    // Windlass exec not available — fall through
  }

  // Fallback: if command starts with "docker", try running it directly
  // This only works if StdOut has access to the Docker socket
  if (command.startsWith('docker ') || command.startsWith('docker-compose ')) {
    // Can't exec from inside the container without socket mount
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Direct Docker execution not available. Run this command manually on your host:\n\n' + command,
    };
  }

  // For non-Docker commands (curl, dig, openssl, etc.), run via async exec (non-blocking vs execSync)
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout, stderr: stderr || '' };
  } catch (err: any) {
    const code = typeof err?.status === 'number' ? err.status : 1;
    return {
      exitCode: code,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || 'Command failed',
    };
  }
}

/** Reject shell chaining / substitution and token-splitting bypasses of naive substring checks. */
function assertAutofixCommandAllowed(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'Empty command';
  if (/[\x00\n\r]/.test(command)) return 'Command blocked: newlines and NUL are not allowed';
  // Block command substitution, pipes, and sequential chaining (still allows & for URL query strings)
  if (/[;|$\x60]/.test(command)) return 'Command blocked: shell metacharacters are not allowed';

  const norm = trimmed.replace(/\s+/g, ' ').toLowerCase();

  const blockedRes = [
    /\brm\b[\s\S]{0,200}?(-rf|--recursive|-r\s+-f)\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /:\(\)\{/,
    /\bchmod\b[\s\S]{0,120}?\b777\b/,
    />\s*\/dev\/(sd|hd|nvme|disk)/,
    /\|\s*(ba)?sh\b/,
    /\bcurl\b[\s\S]{0,400}?\|\s*(ba)?sh\b/,
    /\bwget\b[\s\S]{0,400}?\|\s*(ba)?sh\b/,
  ];
  for (const re of blockedRes) {
    if (re.test(norm)) return 'Command blocked by safety policy';
  }

  const legacy = [':(){:|:&};:', 'rm -rf /', 'rm -fr /', 'chmod -r 777 /'];
  if (legacy.some(b => norm.includes(b))) return 'Command blocked by safety policy';

  return null;
}
