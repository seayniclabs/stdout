// ============================================================================
// SEED DEFAULT SKINS INTO DATABASE
// ============================================================================
// Inserts the 5 built-in skins into the skins table.
// Called during installation step or on first app load.
// ============================================================================

import { getDb, schema } from '../db';
import { defaultSkins } from '../skins/default-skins';

const { skins } = schema;

export async function seedDefaultSkins(): Promise<void> {
  const db = getDb();

  // Check if built-in skins are already seeded
  const existing = await db
    .select()
    .from(skins)
    .where((t) => t.isBuiltIn.eq(true))
    .limit(1);

  if (existing.length > 0) {
    console.log('[seed-skins] Built-in skins already exist, skipping seed');
    return;
  }

  const now = new Date();

  // Insert all default skins
  for (const skin of defaultSkins) {
    await db.insert(skins).values({
      id: skin.id,
      userId: null, // Built-in skins have no owner
      name: skin.name,
      description: skin.description || null,
      author: skin.author,
      version: skin.version,
      isBuiltIn: true,
      isPublic: false, // Built-in skins aren't "community" skins
      colors: JSON.stringify(skin.colors),
      typography: skin.typography ? JSON.stringify(skin.typography) : null,
      spacing: skin.spacing ? JSON.stringify(skin.spacing) : null,
      shadows: skin.shadows ? JSON.stringify(skin.shadows) : null,
      effects: skin.effects ? JSON.stringify(skin.effects) : null,
      thumbnail: null,
      tags: skin.tags.join(','),
      installCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log(`[seed-skins] Seeded ${defaultSkins.length} built-in skins`);
}
