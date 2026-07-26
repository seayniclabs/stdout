/**
 * Incident History Learning RAG
 *
 * Allows Riggins to learn from past incidents via embeddings.
 * Uses Ollama (nomic-embed-text) for local inference.
 */

import { execFileSync } from 'child_process';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const EMBEDDING_MODEL = 'nomic-embed-text';
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://172.17.0.1:11434';
const SIMILARITY_THRESHOLD = 0.7; // Cosine similarity threshold

export interface SimilarIncident {
  id: string;
  title: string;
  description: string;
  resolution: string;
  similarity: number;
  resolved_at: number;
}

/**
 * Generate embedding for incident text
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding;
  } catch (error: any) {
    console.warn('[RAG:IncidentLearning] Embedding generation failed:', error.message);
    return [];
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find similar past incidents based on description
 */
export async function findSimilarIncidents(
  description: string,
  limit: number = 5
): Promise<SimilarIncident[]> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(description);
    if (queryEmbedding.length === 0) {
      return [];
    }

    const db = getDb();

    // Get all resolved incidents with embeddings
    const incidents = await db.all(sql`
      SELECT
        i.id,
        i.title,
        i.description,
        i.resolution,
        i.resolved_at,
        ie.embedding
      FROM incidents i
      JOIN incident_embeddings ie ON i.id = ie.incident_id
      WHERE i.status = 'resolved'
        AND i.resolution IS NOT NULL
        AND i.resolution != ''
      ORDER BY i.resolved_at DESC
      LIMIT 100
    `);

    // Calculate similarities
    const similarities = incidents.map((inc: any) => {
      const embedding = new Float32Array(inc.embedding);
      const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding));

      return {
        id: inc.id,
        title: inc.title,
        description: inc.description,
        resolution: inc.resolution,
        similarity,
        resolved_at: inc.resolved_at
      };
    });

    // Filter by threshold and sort by similarity
    return similarities
      .filter(s => s.similarity >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (error: any) {
    console.warn('[RAG:IncidentLearning] Similarity search failed:', error.message);
    return [];
  }
}

/**
 * Embed a resolved incident (background job)
 */
export async function embedIncident(incidentId: string): Promise<boolean> {
  try {
    const db = getDb();

    // Get incident details
    const incident = await db.get(sql`
      SELECT id, title, description, resolution
      FROM incidents
      WHERE id = ${incidentId}
        AND status = 'resolved'
        AND resolution IS NOT NULL
        AND resolution != ''
    `);

    if (!incident) {
      return false;
    }

    // Check if already embedded
    const existing = await db.get(sql`
      SELECT id FROM incident_embeddings WHERE incident_id = ${incidentId}
    `);

    if (existing) {
      return true; // Already embedded
    }

    // Combine title + description for embedding
    const text = `${incident.title}\n${incident.description}`;
    const embedding = await generateEmbedding(text);

    if (embedding.length === 0) {
      return false;
    }

    // Store embedding as BLOB
    const embeddingBlob = new Float32Array(embedding);
    const buffer = Buffer.from(embeddingBlob.buffer);

    await db.run(sql`
      INSERT INTO incident_embeddings (
        id, incident_id, embedding, embedding_model, created_at
      ) VALUES (
        ${nanoid()}, ${incidentId}, ${buffer}, ${EMBEDDING_MODEL}, ${Date.now()}
      )
    `);

    return true;
  } catch (error: any) {
    console.warn('[RAG:IncidentLearning] Embedding storage failed:', error.message);
    return false;
  }
}

/**
 * Batch embed all unembedded resolved incidents (background job)
 */
export async function batchEmbedIncidents(): Promise<number> {
  try {
    const db = getDb();

    // Find resolved incidents without embeddings
    const unembedded = await db.all(sql`
      SELECT i.id
      FROM incidents i
      LEFT JOIN incident_embeddings ie ON i.id = ie.incident_id
      WHERE i.status = 'resolved'
        AND i.resolution IS NOT NULL
        AND i.resolution != ''
        AND ie.id IS NULL
      LIMIT 50
    `);

    let count = 0;
    for (const inc of unembedded) {
      const success = await embedIncident(inc.id);
      if (success) count++;
    }

    return count;
  } catch (error: any) {
    console.warn('[RAG:IncidentLearning] Batch embedding failed:', error.message);
    return 0;
  }
}

/**
 * Check if incident learning is available
 */
export async function isIncidentLearningAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return false;

    const data = await response.json();
    const models = data.models || [];

    return models.some((m: any) => m.name.includes(EMBEDDING_MODEL));
  } catch {
    return false;
  }
}
