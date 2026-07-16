import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * GET /app/api/presets/:id
 * Fetch preset details by ID
 */
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: 'Preset ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const presetPath = path.join(process.cwd(), 'src', 'data', 'presets', `${id}.json`);
    const presetContent = await fs.readFile(presetPath, 'utf-8');
    const preset = JSON.parse(presetContent);

    return new Response(JSON.stringify(preset), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Preset ${id}] Load error:`, message);

    return new Response(JSON.stringify({
      error: 'Preset not found',
      details: message
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
