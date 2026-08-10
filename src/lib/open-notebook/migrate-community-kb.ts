/**
 * Migrate Community KB to Open-Notebook
 *
 * Phase 3.2: Community Knowledge Packs
 *
 * Migrates existing community_kb table entries to the docs table
 * with Open-Notebook RAG support (chunking, search, etc.)
 */

import { getDb } from '../db';
import * as schema from '../db/schema';
import { sql, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { chunkDocument } from './chunking';

export interface CommunityKBEntry {
  id: string;
  title: string;
  category: string;
  problem_pattern: string;
  solution: string;
  tags: string;
  upvotes: number;
  downvotes: number;
}

/**
 * Migrate all community KB entries to docs table
 */
export async function migrateCommunityKBToDocs(): Promise<MigrationResult> {
  const db = getDb();
  const migrated: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  console.log('[Migration] Starting community KB → docs migration');

  try {
    // Fetch all community KB entries
    const entries = await db.all<CommunityKBEntry>(sql`
      SELECT id, title, category, problem_pattern, solution, tags, upvotes, downvotes
      FROM community_kb
    `);

    console.log('[Migration] Found', entries.length, 'community KB entries');

    for (const entry of entries) {
      try {
        // Create slug from title
        const slug = createSlug(entry.title);

        // Check if already migrated
        const existing = await db
          .select({ id: schema.docs.id })
          .from(schema.docs)
          .where(eq(schema.docs.slug, slug))
          .get();

        if (existing) {
          skipped.push(entry.id);
          continue;
        }

        // Format as markdown
        const content = formatCommunityKBAsMarkdown(entry);

        // Parse tags
        const tags = JSON.parse(entry.tags || '[]');
        tags.push('community-kb', `category:${entry.category}`);

        // Create doc
        const docId = nanoid();
        await db.insert(schema.docs).values({
          id: docId,
          type: 'guide',
          title: entry.title,
          slug: slug,
          content: content,
          tags: JSON.stringify(tags),
          visibility: 'public',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Chunk content
        const chunks = chunkDocument(content);

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

        migrated.push(entry.id);
        console.log('[Migration] Migrated:', entry.title, `(${chunks.length} chunks)`);
      } catch (error) {
        errors.push({
          id: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error('[Migration] Error migrating:', entry.id, error);
      }
    }

    const result: MigrationResult = {
      total: entries.length,
      migrated: migrated.length,
      skipped: skipped.length,
      errors: errors.length,
      details: {
        migrated,
        skipped,
        errors,
      },
    };

    console.log('[Migration] Complete:', result);
    return result;
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
    throw error;
  }
}

/**
 * Format community KB entry as markdown
 */
function formatCommunityKBAsMarkdown(entry: CommunityKBEntry): string {
  return `# ${entry.title}

## Problem Pattern

${entry.problem_pattern}

## Solution

${entry.solution}

## Community Feedback

- **Upvotes:** ${entry.upvotes}
- **Downvotes:** ${entry.downvotes}
- **Score:** ${entry.upvotes - entry.downvotes}

## Category

\`${entry.category}\`

## Tags

${JSON.parse(entry.tags || '[]').map((tag: string) => `\`${tag}\``).join(' ')}

---

*Migrated from Community Knowledge Base*
`;
}

/**
 * Create URL-safe slug from title
 */
function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .substring(0, 100);
}

export interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  details: {
    migrated: string[];
    skipped: string[];
    errors: Array<{ id: string; error: string }>;
  };
}

/**
 * Check migration status
 */
export async function getMigrationStatus(): Promise<{
  communityKBCount: number;
  docsGuideCount: number;
  migrationComplete: boolean;
}> {
  const db = getDb();

  try {
    // Count community KB entries
    const kbResult = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) as count FROM community_kb
    `);
    const communityKBCount = kbResult[0]?.count || 0;

    // Count docs with community-kb tag
    const docs = await db
      .select({ id: schema.docs.id, tags: schema.docs.tags })
      .from(schema.docs)
      .where(eq(schema.docs.type, 'guide'))
      .all();

    const docsGuideCount = docs.filter(d => {
      const tags = JSON.parse(d.tags || '[]');
      return tags.includes('community-kb');
    }).length;

    return {
      communityKBCount,
      docsGuideCount,
      migrationComplete: docsGuideCount >= communityKBCount,
    };
  } catch (error) {
    console.error('[Migration] Failed to check status:', error);
    return {
      communityKBCount: 0,
      docsGuideCount: 0,
      migrationComplete: false,
    };
  }
}
