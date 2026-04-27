import type { APIRoute } from 'astro';
import { getN8nWorkflowWindows } from '../../../../lib/windlass';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const workflows = await getN8nWorkflowWindows(userId);

  return new Response(JSON.stringify({ workflows }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
