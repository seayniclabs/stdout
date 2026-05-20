import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response('null', { headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    id: locals.user.id,
    email: locals.user.email,
    displayName: locals.user.displayName,
    role: locals.user.role,
  }), { headers: { 'Content-Type': 'application/json' } });
};
