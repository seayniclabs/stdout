/**
 * LLM Task Routing API
 * GET /app/api/llm/routing - List task routing configuration
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { llmTaskRouting, llmModels } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';

const db = getDb();

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const routing = await db.select().from(llmTaskRouting).all();

    // Enrich with model names
    const enriched = await Promise.all(
      routing.map(async (route) => {
        let preferredModelName = null;
        if (route.preferredModelId) {
          const model = await db
            .select()
            .from(llmModels)
            .where(eq(llmModels.id, route.preferredModelId))
            .get();
          preferredModelName = model?.displayName || null;
        }

        return {
          ...route,
          preferredModelName,
        };
      })
    );

    return new Response(JSON.stringify({ routing: enriched }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
