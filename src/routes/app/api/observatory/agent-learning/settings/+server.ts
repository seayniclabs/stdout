import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/db';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  // Get agent config for this user
  const config = await db.get(sql`
    SELECT * FROM agent_config WHERE user_id = ${locals.user.id}
  `);

  if (!config) {
    // Return defaults
    return json({
      settings: {
        docs_rag_enabled: true,
        incident_learning_enabled: true,
        community_kb_enabled: true,
        community_sharing_enabled: false,
        custom_notebook_id: '',
        proactive_suggestions: false
      }
    });
  }

  // Parse extended config from JSON column
  const extended = config.extended_config ? JSON.parse(config.extended_config) : {};

  return json({
    settings: {
      docs_rag_enabled: extended.docs_rag_enabled ?? true,
      incident_learning_enabled: extended.incident_learning_enabled ?? true,
      community_kb_enabled: extended.community_kb_enabled ?? true,
      community_sharing_enabled: extended.community_sharing_enabled ?? false,
      custom_notebook_id: extended.custom_notebook_id || '',
      proactive_suggestions: config.proactive_notifications === 1
    }
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await request.json();
  const db = getDb();

  // Get existing config
  const existing = await db.get(sql`
    SELECT id, extended_config FROM agent_config WHERE user_id = ${locals.user.id}
  `);

  if (!existing) {
    return json({ error: 'Agent config not found' }, { status: 404 });
  }

  // Merge with existing extended config
  const extendedConfig = existing.extended_config ? JSON.parse(existing.extended_config) : {};

  const newExtendedConfig = {
    ...extendedConfig,
    docs_rag_enabled: settings.docs_rag_enabled,
    incident_learning_enabled: settings.incident_learning_enabled,
    community_kb_enabled: settings.community_kb_enabled,
    community_sharing_enabled: settings.community_sharing_enabled,
    custom_notebook_id: settings.custom_notebook_id || ''
  };

  // Update config
  await db.run(sql`
    UPDATE agent_config
    SET
      extended_config = ${JSON.stringify(newExtendedConfig)},
      proactive_notifications = ${settings.proactive_suggestions ? 1 : 0},
      updated_at = ${Date.now()}
    WHERE id = ${existing.id}
  `);

  return json({ success: true });
};
