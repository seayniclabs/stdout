/**
 * Auto-Learning System
 *
 * Phase 3.1: Open-Notebook Local RAG
 *
 * Automatically generates post-mortems from resolved incidents:
 * - Incident resolved → extract lessons learned
 * - Generate structured post-mortem document
 * - Add to local knowledge base for future reference
 * - Riggins uses this to solve similar incidents faster
 */

import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { chunkDocument } from './chunking';

export interface PostMortemData {
  incidentId: string;
  title: string;
  summary: string;
  rootCause: string;
  resolution: string;
  lessonsLearned: string[];
  tags: string[];
}

/**
 * Generate a post-mortem document from a resolved incident
 */
export async function generatePostMortem(
  incidentId: string
): Promise<string | null> {
  const db = getDb();

  try {
    // Fetch incident details
    const incident = await db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, incidentId))
      .get();

    if (!incident) {
      console.error('[Auto-Learning] Incident not found:', incidentId);
      return null;
    }

    // Check if incident is resolved
    if (incident.status !== 'resolved' && incident.status !== 'closed') {
      console.warn('[Auto-Learning] Incident not resolved:', incidentId);
      return null;
    }

    // Extract post-mortem data
    const postMortemData = extractPostMortemData(incident);

    // Generate markdown content
    const content = formatPostMortem(postMortemData);

    // Create slug from title
    const slug = createSlug(postMortemData.title);

    // Save to docs table
    const docId = nanoid();
    await db.insert(schema.docs).values({
      id: docId,
      type: 'post-mortem',
      title: postMortemData.title,
      slug: slug,
      content: content,
      tags: JSON.stringify(postMortemData.tags),
      visibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Chunk the document for RAG
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

    console.log('[Auto-Learning] Post-mortem created:', {
      docId,
      incidentId,
      title: postMortemData.title,
      chunks: chunks.length,
    });

    return docId;
  } catch (error) {
    console.error('[Auto-Learning] Failed to generate post-mortem:', error);
    return null;
  }
}

/**
 * Extract post-mortem data from incident
 */
function extractPostMortemData(incident: any): PostMortemData {
  const title = `Post-Mortem: ${incident.title}`;
  const summary = incident.description || 'No description available.';

  // Extract root cause from diagnosis (if available)
  let rootCause = 'Root cause not determined.';
  if (incident.diagnosis) {
    try {
      const diagnosis = JSON.parse(incident.diagnosis);
      rootCause = diagnosis.rootCause || diagnosis.explanation || rootCause;
    } catch {
      rootCause = incident.diagnosis;
    }
  }

  // Extract resolution from resolution field or status notes
  let resolution = 'Resolution not documented.';
  if (incident.resolution) {
    resolution = incident.resolution;
  } else if (incident.statusNotes) {
    resolution = incident.statusNotes;
  }

  // Extract lessons learned (heuristic: look for patterns)
  const lessonsLearned: string[] = [];

  // Lesson 1: What failed
  if (incident.severity === 'critical' || incident.severity === 'high') {
    lessonsLearned.push(
      `High-severity incident affecting ${incident.affectedServices || 'services'}. Ensure monitoring coverage is comprehensive.`
    );
  }

  // Lesson 2: Detection time
  if (incident.detectedAt && incident.createdAt) {
    const detectionDelay = new Date(incident.detectedAt).getTime() - new Date(incident.createdAt).getTime();
    if (detectionDelay > 300000) { // 5 minutes
      lessonsLearned.push('Detection delay exceeded 5 minutes. Consider adding proactive alerts.');
    }
  }

  // Lesson 3: Resolution pattern
  if (resolution.toLowerCase().includes('restart') || resolution.toLowerCase().includes('reboot')) {
    lessonsLearned.push('Service restart resolved the issue. Investigate underlying stability problems.');
  }

  if (resolution.toLowerCase().includes('disk') || resolution.toLowerCase().includes('storage')) {
    lessonsLearned.push('Disk/storage issue detected. Implement capacity monitoring and auto-cleanup.');
  }

  if (resolution.toLowerCase().includes('memory') || resolution.toLowerCase().includes('oom')) {
    lessonsLearned.push('Memory issue detected. Review resource limits and memory leak patterns.');
  }

  // Extract tags from incident
  const tags: string[] = [];
  if (incident.severity) tags.push(incident.severity);
  if (incident.category) tags.push(incident.category);
  if (incident.affectedServices) {
    const services = incident.affectedServices.split(',').map((s: string) => s.trim());
    tags.push(...services);
  }
  tags.push('post-mortem', 'auto-generated');

  return {
    incidentId: incident.id,
    title,
    summary,
    rootCause,
    resolution,
    lessonsLearned: lessonsLearned.length > 0 ? lessonsLearned : ['No specific lessons extracted.'],
    tags,
  };
}

/**
 * Format post-mortem as markdown
 */
function formatPostMortem(data: PostMortemData): string {
  return `# ${data.title}

## Incident Summary

${data.summary}

## Root Cause

${data.rootCause}

## Resolution

${data.resolution}

## Lessons Learned

${data.lessonsLearned.map((lesson, i) => `${i + 1}. ${lesson}`).join('\n')}

## Related Incidents

This post-mortem was auto-generated from incident: \`${data.incidentId}\`

## Tags

${data.tags.map(tag => `\`${tag}\``).join(' ')}

---

*Auto-generated by StdOut Open-Notebook on ${new Date().toISOString().split('T')[0]}*
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

/**
 * Check if post-mortem already exists for incident
 */
export async function hasPostMortem(incidentId: string): Promise<boolean> {
  const db = getDb();

  try {
    const existing = await db
      .select({ id: schema.docs.id })
      .from(schema.docs)
      .where(eq(schema.docs.type, 'post-mortem'))
      .all();

    // Check if any post-mortem references this incident ID
    for (const doc of existing) {
      const fullDoc = await db
        .select({ content: schema.docs.content })
        .from(schema.docs)
        .where(eq(schema.docs.id, doc.id))
        .get();

      if (fullDoc?.content.includes(incidentId)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[Auto-Learning] Check post-mortem error:', error);
    return false;
  }
}

/**
 * Auto-generate post-mortems for all resolved incidents
 * (Useful for backfilling knowledge base)
 */
export async function backfillPostMortems(): Promise<number> {
  const db = getDb();
  let generated = 0;

  try {
    // Find all resolved/closed incidents
    const resolvedIncidents = await db
      .select({ id: schema.incidents.id })
      .from(schema.incidents)
      .where(eq(schema.incidents.status, 'resolved'))
      .all();

    console.log('[Auto-Learning] Found', resolvedIncidents.length, 'resolved incidents');

    for (const incident of resolvedIncidents) {
      // Skip if post-mortem already exists
      if (await hasPostMortem(incident.id)) {
        continue;
      }

      // Generate post-mortem
      const docId = await generatePostMortem(incident.id);
      if (docId) {
        generated++;
      }

      // Rate limit to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('[Auto-Learning] Generated', generated, 'post-mortems');
    return generated;
  } catch (error) {
    console.error('[Auto-Learning] Backfill error:', error);
    return generated;
  }
}
