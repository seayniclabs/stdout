import type { APIRoute } from 'astro';

function getWindlassUrl(): string | null {
  const url = process.env.WINDLASS_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

export const PUT: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

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
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Windlass unreachable: ${err.message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
