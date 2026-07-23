import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;
  return new Response(JSON.stringify({
    id: locals.user.id,
    email: locals.user.email,
    displayName: locals.user.displayName,
    role: locals.user.role,
  }), { headers: { 'Content-Type': 'application/json' } });
};
