import type { APIRoute } from 'astro';
import { generateDigest, renderDigestHTML, sendWeeklyDigests } from '../../../lib/digest';

// GET — preview digest for current user (returns HTML)
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const data = generateDigest(locals.user.id);
  if (!data) {
    return new Response('No activity this week — digest would be skipped.', {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    });
  }

  const appUrl = process.env.APP_URL || 'https://stdout.seaynicroute.com';
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
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  // RBAC gate
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  // Tier gate: weekly digest
  const { checkFeature, tierBlockedResponse } = await import('../../../lib/tier-gate');
  const gate = checkFeature(locals.user, 'weeklyDigest');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  const sent = await sendWeeklyDigests();

  return new Response(JSON.stringify({ sent, message: `Digest sent to ${sent} user(s)` }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
