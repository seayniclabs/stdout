/**
 * LLM Providers API
 * GET /app/api/llm/providers - List all providers
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { llmProviders, llmModels } from '../../../../lib/db/schema';
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
    const providers = await db.select().from(llmProviders).orderBy(llmProviders.priority).all();

    // Get models for each provider
    const providersWithModels = await Promise.all(
      providers.map(async (provider) => {
        const models = await db
          .select()
          .from(llmModels)
          .where(eq(llmModels.providerId, provider.id))
          .orderBy(llmModels.priority)
          .all();

        return {
          ...provider,
          models,
        };
      })
    );

    return new Response(JSON.stringify({ providers: providersWithModels }), {
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
