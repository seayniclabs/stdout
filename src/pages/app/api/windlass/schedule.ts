import type { APIRoute } from 'astro';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

function getWindlassUrl(): string | null {
  const url = process.env.WINDLASS_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

export const PUT: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  const windlassUrl = getWindlassUrl();
  if (!windlassUrl) {
    return new Response(JSON.stringify({ error: 'WINDLASS_URL is not configured' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { yaml?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const yaml = body.yaml?.trim();
  if (!yaml) {
    return new Response(JSON.stringify({ error: 'yaml is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsed = yaml.includes('services:');
    if (!parsed) {
      return new Response(JSON.stringify({ error: 'YAML must contain a services: block' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid YAML' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const res = await fetch(`${windlassUrl}/config/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/yaml' },
      body: yaml,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.error || 'Windlass rejected schedule' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, ...data }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: `Windlass unreachable: ${error instanceof Error ? error.message : String(error)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
