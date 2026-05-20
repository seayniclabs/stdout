import type { APIRoute } from 'astro';
import { getStoredLicense, isValidLicenseKeyFormat, storeLicense } from '../../../lib/license';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const row = getStoredLicense();
  return new Response(JSON.stringify({
    activated: !!row,
    email: row?.email ?? null,
    edition: row?.edition ?? null,
    lastCheckedAt: row?.lastCheckedAt?.getTime() ?? null,
  }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: { key?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const key = (body.key || '').trim();
  if (!isValidLicenseKeyFormat(key)) {
    return new Response(JSON.stringify({ error: 'Invalid license key format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email || locals.user.email).trim();
  storeLicense(key, email);
  return new Response(JSON.stringify({ stored: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
