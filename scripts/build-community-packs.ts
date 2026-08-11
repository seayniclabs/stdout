/**
 * Build Community Knowledge Packs
 *
 * Phase 3.2: Community Knowledge Packs Structure
 *
 * Converts markdown docs in community-packs/ to pack.json format:
 * - Reads all .md files in a pack's docs/ directory
 * - Generates pack.json with metadata + docs
 * - Auto-chunks content for RAG search
 * - Outputs to pack's root directory
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { chunkDocument } from '../src/lib/open-notebook/chunking';

interface PackConfig {
  id: string;
  title: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  tags?: string[];
}

interface PackDoc {
  id: string;
  title: string;
  slug: string;
  content: string;
  category?: string;
  tags: string[];
  chunks: Array<{
    index: number;
    content: string;
    startOffset: number;
    endOffset: number;
  }>;
}

interface KnowledgePack {
  pack: PackConfig;
  docs: PackDoc[];
}

const PACKS_DIR = join(process.cwd(), 'community-packs');

/**
 * Create slug from title
 */
function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract title from markdown (first # heading)
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

/**
 * Extract tags from markdown frontmatter or content
 */
function extractTags(content: string, packId: string): string[] {
  const tags: string[] = [packId];

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
function buildPack(packDirName: string): KnowledgePack | null {
  const packDir = join(PACKS_DIR, packDirName);
  const docsDir = join(packDir, 'docs');

  if (!existsSync(docsDir)) {
    console.warn(`[Pack Builder] No docs/ directory in ${packDirName}, skipping`);
    return null;
  }

  // Read pack metadata (if exists) or use defaults
  const configPath = join(packDir, 'pack-config.json');
  let packConfig: PackConfig;

  if (existsSync(configPath)) {
    packConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } else {
    // Generate default config
    packConfig = {
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
  }

  console.log(`[Pack Builder] Building pack: ${packConfig.title}`);

  // Read all markdown files in docs/
  const mdFiles = readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(docsDir, f));

  const docs: PackDoc[] = [];

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
 * Main build process
 */
function main() {
  if (!existsSync(PACKS_DIR)) {
    console.error('[Pack Builder] community-packs/ directory not found');
    process.exit(1);
  }

  const packDirs = readdirSync(PACKS_DIR).filter(name => {
    const path = join(PACKS_DIR, name);
    return statSync(path).isDirectory();
  });

  console.log(`[Pack Builder] Found ${packDirs.length} pack directories`);

  let totalBuilt = 0;
  let totalDocs = 0;

  for (const packDir of packDirs) {
    const pack = buildPack(packDir);
    if (!pack) continue;

    // Write pack.json
    const outputPath = join(PACKS_DIR, packDir, 'pack.json');
    writeFileSync(outputPath, JSON.stringify(pack, null, 2));

    console.log(`  ✓ Wrote ${outputPath} (${pack.docs.length} docs)`);
    totalBuilt++;
    totalDocs += pack.docs.length;
  }

  console.log(`\n[Pack Builder] Build complete:`);
  console.log(`  Packs built: ${totalBuilt}`);
  console.log(`  Total docs: ${totalDocs}`);
}

main();
