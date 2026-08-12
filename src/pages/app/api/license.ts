import type { APIRoute } from 'astro';
import { getStoredLicense, isValidLicenseKeyFormat, storeLicense } from '../../../lib/license';
import { requireAuth } from '../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const row = getStoredLicense();
  return new Response(JSON.stringify({
    activated: !!row,
    email: row?.email ?? null,
    edition: row?.edition ?? null,
    lastCheckedAt: row?.lastCheckedAt?.getTime() ?? null,
  }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  let body: { key?: string; email?: string; _csrf?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const key = (body.key || '').trim();
  if (!isValidLicenseKeyFormat(key)) {
    return new Response(JSON.stringify({ error: 'Invalid license key format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the license signature before storing
  const { verifyLicenseSignature } = await import('../../../lib/license');
  const verifyResult = verifyLicenseSignature(key);

  if (!verifyResult.valid) {
    return new Response(JSON.stringify({
      error: verifyResult.reason || 'Invalid license key',
      valid: false
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email || locals.user.email).trim();
  storeLicense(key, email, verifyResult.payload?.product || 'self-host');

  return new Response(JSON.stringify({
    stored: true,
    valid: true,
    edition: verifyResult.payload?.product || 'self-host',
    email: verifyResult.payload?.email
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
