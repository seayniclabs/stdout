/**
 * Standalone Pack Import Script
 *
 * Phase 3.2: Community Knowledge Packs
 *
 * Self-contained version that works in production containers.
 * Embeds the pack-importer logic inline.
 *
 * Usage: node scripts/import-pack-standalone.js <pack-name>
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const DB_PATH = process.env.DB_PATH || '/app/data/stdout.db';

/**
 * Chunk document (simplified version)
 */
function chunkDocument(content, maxSize = 800, overlap = 100) {
  const chunks = [];
  const paragraphs = content.split(/\n\n+/);

  let currentChunk = '';
  let currentStart = 0;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        index: chunkIndex++,
        content: currentChunk.trim(),
        startOffset: currentStart,
        endOffset: currentStart + currentChunk.length,
      });

      // Start new chunk with overlap
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + '\n\n' + para;
      currentStart += currentChunk.length - overlap;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  // Save final chunk
  if (currentChunk.trim()) {
    chunks.push({
      index: chunkIndex,
      content: currentChunk.trim(),
      startOffset: currentStart,
      endOffset: currentStart + currentChunk.length,
    });
  }

  return chunks;
}

/**
 * Import a knowledge pack into the database
 */
async function importPack(pack, db) {
  const imported = [];
  const skipped = [];
  const errors = [];

  console.log('[Pack Importer] Starting import:', pack.pack.title);

  for (const doc of pack.docs) {
    try {
      // Check if doc already exists (by slug)
      const existing = db.prepare('SELECT id FROM docs WHERE slug = ?').get(doc.slug);

      if (existing) {
        skipped.push(doc.id);
        continue;
      }

      // Create doc
      const docId = nanoid();
      const now = Date.now();

      db.prepare(`
        INSERT INTO docs (id, type, title, slug, content, tags, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        docId,
        'guide',
        doc.title,
        doc.slug,
        doc.content,
        JSON.stringify(doc.tags),
        'public',
        now,
        now
      );

      // Chunk content
      const chunks = chunkDocument(doc.content);

      // Save chunks
      const insertChunk = db.prepare(`
        INSERT INTO doc_chunks (id, doc_id, chunk_index, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const chunk of chunks) {
        insertChunk.run(
          nanoid(),
          docId,
          chunk.index,
          chunk.content,
          now
        );
      }

      imported.push(doc.id);
      console.log('[Pack Importer] Imported:', doc.title, `(${chunks.length} chunks)`);
    } catch (error) {
      errors.push({
        docId: doc.id,
        error: error.message,
      });
      console.error('[Pack Importer] Error importing:', doc.id, error.message);
    }
  }

  return {
    packId: pack.pack.id,
    packTitle: pack.pack.title,
    imported: imported.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { imported, skipped, errors },
  };
}

/**
 * Main
 */
async function main() {
  const packName = process.argv[2];

  if (!packName) {
    console.error('Usage: node scripts/import-pack-standalone.js <pack-name>');
    process.exit(1);
  }

  const packPath = join(process.cwd(), 'community-packs', packName, 'pack.json');

  try {
    // Load pack
    const packJson = readFileSync(packPath, 'utf-8');
    const pack = JSON.parse(packJson);

    // Connect to database
    const db = new Database(DB_PATH);

    console.log('[Pack Import] Importing:', pack.pack.title);
    const result = await importPack(pack, db);

    db.close();

    console.log('[Pack Import] Complete:');
    console.log(`  Imported: ${result.imported} docs`);
    console.log(`  Skipped: ${result.skipped} docs (already exist)`);
    console.log(`  Errors: ${result.errors}`);

    if (result.errors > 0) {
      console.log('\nErrors:');
      result.details.errors.forEach(e => console.log(`  - ${e.docId}: ${e.error}`));
      process.exit(1);
    }

    if (result.imported > 0) {
      console.log('\n✓ Pack imported successfully');
    } else if (result.skipped > 0) {
      console.log('\n⚠ All docs already exist in knowledge base');
    }
  } catch (error) {
    console.error('[Pack Import] Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
