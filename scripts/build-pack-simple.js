/**
 * Simple Pack Builder
 *
 * Builds pack.json from markdown docs without TypeScript dependencies
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';

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
 * Create slug from title
 */
function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract title from markdown (first # heading)
 */
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

/**
 * Extract tags from markdown frontmatter or content
 */
function extractTags(content, packId) {
  const tags = [packId];

  // Check for YAML frontmatter tags
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (frontmatterMatch) {
    const yamlContent = frontmatterMatch[1];
    const tagsMatch = yamlContent.match(/tags:\s*\[([^\]]+)\]/);
    if (tagsMatch) {
      const yamlTags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
      tags.push(...yamlTags);
    }
  }

  return [...new Set(tags)]; // dedupe
}

/**
 * Build a single pack
 */
function buildPack(packDirName, packsDir) {
  const packDir = join(packsDir, packDirName);
  const docsDir = join(packDir, 'docs');

  if (!existsSync(docsDir)) {
    console.warn(`[Pack Builder] No docs/ directory in ${packDirName}, skipping`);
    return null;
  }

  // Generate default config
  const packConfig = {
    id: packDirName,
    title: packDirName
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    description: `Curated ${packDirName.replace(/-/g, ' ')} guides`,
    version: '1.0.0',
    author: 'Seaynic Labs',
    category: packDirName.split('-')[0],
    tags: [packDirName],
  };

  console.log(`[Pack Builder] Building pack: ${packConfig.title}`);

  // Read all markdown files in docs/
  const mdFiles = readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(docsDir, f));

  const docs = [];

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const filename = basename(filePath, '.md');
    const title = extractTitle(content);
    const slug = createSlug(title);
    const tags = extractTags(content, packConfig.id);

    // Chunk the document
    const chunks = chunkDocument(content);

    docs.push({
      id: filename,
      title,
      slug,
      content,
      category: packConfig.category,
      tags,
      chunks: chunks.map(c => ({
        index: c.index,
        content: c.content,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
      })),
    });

    console.log(`  ✓ ${title} (${chunks.length} chunks)`);
  }

  return {
    pack: packConfig,
    docs,
  };
}

/**
 * Main
 */
async function main() {
  const packName = process.argv[2];
  const packsDir = join(process.cwd(), 'community-packs');

  if (!packName) {
    console.error('Usage: node scripts/build-pack-simple.js <pack-name>');
    process.exit(1);
  }

  if (!existsSync(packsDir)) {
    console.error('[Pack Builder] community-packs/ directory not found');
    process.exit(1);
  }

  const pack = buildPack(packName, packsDir);
  if (!pack) {
    console.error(`[Pack Builder] Failed to build pack: ${packName}`);
    process.exit(1);
  }

  // Write pack.json
  const outputPath = join(packsDir, packName, 'pack.json');
  writeFileSync(outputPath, JSON.stringify(pack, null, 2));

  console.log(`\n[Pack Builder] Build complete:`);
  console.log(`  Pack: ${pack.pack.title}`);
  console.log(`  Docs: ${pack.docs.length}`);
  console.log(`  Output: ${outputPath}`);
}

main();
