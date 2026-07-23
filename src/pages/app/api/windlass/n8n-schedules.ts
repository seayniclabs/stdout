import type { APIRoute } from 'astro';
import { getN8nWorkflowWindowsForDisplay } from '../../../../lib/windlass';
import { requireAuth } from '../../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.workspace?.ownerId || locals.user.id;
  const workflows = await getN8nWorkflowWindowsForDisplay(userId);

  return new Response(JSON.stringify({ workflows }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
