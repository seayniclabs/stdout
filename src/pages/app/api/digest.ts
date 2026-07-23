import type { APIRoute } from 'astro';
import { generateDigest, renderDigestHTML, sendWeeklyDigests } from '../../../lib/digest';
import { requireAuth } from '../../../lib/rbac';

// GET — preview digest for current user (returns HTML)
export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const data = generateDigest(locals.user.id);
  if (!data) {
    return new Response('No activity this week — digest would be skipped.', {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = renderDigestHTML(data, appUrl);

  // If ?json=1, return raw data
  if (url.searchParams.get('json') === '1') {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
};

// POST — trigger digest send for all users (admin or Bearer token)
export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC gate
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Tier gate: weekly digest
  const { checkFeature, tierBlockedResponse } = await import('../../../lib/tier-gate');
  const gate = checkFeature(locals.user, 'weeklyDigest');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  const sent = await sendWeeklyDigests();

  return new Response(JSON.stringify({ sent, message: `Digest sent to ${sent} user(s)` }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
