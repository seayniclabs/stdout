import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAuth } from '../../../../lib/rbac';

const execAsync = promisify(exec);

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'view');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tools = [
    { name: 'Suricata', command: 'suricata --build-info', parseVersion: (output: string) => output.match(/This is Suricata version ([0-9.]+)/)?.[1] },
    { name: 'Wireshark/tshark', command: 'tshark --version', parseVersion: (output: string) => output.match(/TShark .*?([0-9.]+)/)?.[1] },
    { name: 'Zeek', command: 'zeek --version', parseVersion: (output: string) => output.match(/zeek version ([0-9.]+)/)?.[1] },
    { name: 'Prometheus', command: 'prometheus --version', parseVersion: (output: string) => output.match(/prometheus, version ([0-9.]+)/)?.[1] },
    { name: 'Loki', command: 'loki --version', parseVersion: (output: string) => output.match(/loki, version ([0-9.]+)/)?.[1] },
    { name: 'Wazuh', command: 'wazuh-control status', parseVersion: () => null },
    { name: 'CrowdSec', command: 'crowdsec --version', parseVersion: (output: string) => output.match(/version ([0-9.]+)/)?.[1] },
    { name: 'ntopng', command: 'ntopng --version', parseVersion: (output: string) => output.match(/v\.([0-9.]+)/)?.[1] },
    { name: 'Falco', command: 'falco --version', parseVersion: (output: string) => output.match(/Falco version ([0-9.]+)/)?.[1] }
  ];

  const results = await Promise.all(
    tools.map(async (tool) => {
      try {
        const { stdout, stderr } = await execAsync(tool.command, { timeout: 5000 });
        const output = stdout + stderr;
        const version = tool.parseVersion(output);

        return {
          name: tool.name,
          detected: true,
          version: version || 'unknown',
          raw: output.split('\n')[0]
        };
      } catch (error: unknown) {
        return {
          name: tool.name,
          detected: false,
          version: null,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  const detected = results.filter(r => r.detected);
  const notFound = results.filter(r => !r.detected);

  return new Response(JSON.stringify({
    summary: `Found ${detected.length}/${tools.length} security tools`,
    detected,
    notFound
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
