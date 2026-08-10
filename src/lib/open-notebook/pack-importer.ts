/**
 * Community Knowledge Pack Importer
 *
 * Phase 3.2: Community Knowledge Packs
 *
 * Imports curated knowledge packs into the local knowledge base:
 * - Reads pack.json files
 * - Creates docs entries
 * - Auto-chunks content
 * - Makes searchable via RAG engine
 */

import { getDb } from '../db';
import * as schema from '../db/schema';
import { nanoid } from 'nanoid';
import { chunkDocument } from './chunking';
import { eq } from 'drizzle-orm';

export interface PackMetadata {
  id: string;
  title: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  tags?: string[];
}

export interface PackDoc {
  id: string;
  title: string;
  slug: string;
  content: string;
  category?: string;
  tags: string[];
}

export interface KnowledgePack {
  pack: PackMetadata;
  docs: PackDoc[];
}

/**
 * Import a knowledge pack into the database
 */
export async function importPack(pack: KnowledgePack): Promise<ImportResult> {
  const db = getDb();
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ docId: string; error: string }> = [];

  console.log('[Pack Importer] Starting import:', pack.pack.title);

  for (const doc of pack.docs) {
    try {
      // Check if doc already exists (by slug)
      const existing = await db
        .select({ id: schema.docs.id })
        .from(schema.docs)
        .where(eq(schema.docs.slug, doc.slug))
        .get();

      if (existing) {
        skipped.push(doc.id);
        continue;
      }

      // Create doc
      const docId = nanoid();
      await db.insert(schema.docs).values({
        id: docId,
        type: 'guide',
        title: doc.title,
        slug: doc.slug,
        content: doc.content,
        tags: JSON.stringify(doc.tags),
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Chunk content
      const chunks = chunkDocument(doc.content);

      // Save chunks
      for (const chunk of chunks) {
        await db.insert(schema.docChunks).values({
          id: nanoid(),
          docId: docId,
          chunkIndex: chunk.index,
          content: chunk.content,
          createdAt: new Date(),
        });
      }

      imported.push(doc.id);
      console.log('[Pack Importer] Imported:', doc.title, `(${chunks.length} chunks)`);
    } catch (error) {
      errors.push({
        docId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[Pack Importer] Error importing:', doc.id, error);
    }
  }

  const result = {
    packId: pack.pack.id,
    packTitle: pack.pack.title,
    imported: imported.length,
    skipped: skipped.length,
    errors: errors.length,
    details: {
      imported,
      skipped,
      errors,
    },
  };

  console.log('[Pack Importer] Import complete:', result);
  return result;
}

/**
 * Import result summary
 */
export interface ImportResult {
  packId: string;
  packTitle: string;
  imported: number;
  skipped: number;
  errors: number;
  details: {
    imported: string[];
    skipped: string[];
    errors: Array<{ docId: string; error: string }>;
  };
}

/**
 * Load pack from JSON file
 */
export async function loadPackFromFile(filepath: string): Promise<KnowledgePack | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filepath, 'utf-8');
    const pack = JSON.parse(content) as KnowledgePack;

    // Validate pack structure
    if (!pack.pack || !pack.pack.id || !pack.pack.title) {
      throw new Error('Invalid pack structure: missing pack metadata');
    }

    if (!Array.isArray(pack.docs)) {
      throw new Error('Invalid pack structure: docs must be an array');
    }

    return pack;
  } catch (error) {
    console.error('[Pack Importer] Failed to load pack:', filepath, error);
    return null;
  }
}

/**
 * Import all packs from a directory
 */
export async function importPacksFromDirectory(dirpath: string): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  try {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const entries = await readdir(dirpath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const packJsonPath = join(dirpath, entry.name, 'pack.json');
      const pack = await loadPackFromFile(packJsonPath);

      if (pack) {
        const result = await importPack(pack);
        results.push(result);
      }
    }

    console.log('[Pack Importer] Imported', results.length, 'packs');
    return results;
  } catch (error) {
    console.error('[Pack Importer] Failed to scan directory:', dirpath, error);
    return results;
  }
}

/**
 * List installed packs
 */
export async function listInstalledPacks(): Promise<PackSummary[]> {
  const db = getDb();

  try {
    // Get all guide-type docs grouped by tags
    const guides = await db
      .select({
        id: schema.docs.id,
        title: schema.docs.title,
        tags: schema.docs.tags,
        createdAt: schema.docs.createdAt,
      })
      .from(schema.docs)
      .where(eq(schema.docs.type, 'guide'))
      .all();

    // Group by pack (heuristic: docs with same tag prefix)
    const packMap = new Map<string, PackSummary>();

    for (const guide of guides) {
      const tags = JSON.parse(guide.tags || '[]');
      const packTag = tags.find((t: string) => t.startsWith('pack:'));

      if (packTag) {
        const packId = packTag.replace('pack:', '');
        if (!packMap.has(packId)) {
          packMap.set(packId, {
            packId,
            title: packId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            docCount: 0,
            installedAt: guide.createdAt,
          });
        }
        packMap.get(packId)!.docCount++;
      }
    }

    return Array.from(packMap.values());
  } catch (error) {
    console.error('[Pack Importer] Failed to list packs:', error);
    return [];
  }
}

export interface PackSummary {
  packId: string;
  title: string;
  docCount: number;
  installedAt: Date;
}
