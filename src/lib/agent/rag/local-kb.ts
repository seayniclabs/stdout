/**
 * Local Knowledge Base RAG Integration
 *
 * Riggins tool integration for Open-Notebook local RAG engine.
 * Uses SQLite FTS5 for sub-100ms retrieval, zero external APIs.
 */

import { searchKnowledgeBase } from '../../open-notebook/rag-engine';
import type { SearchResult } from '../../open-notebook/rag-engine';

export interface DocumentQueryResult {
  available: boolean;
  answer: string | null;
  sources: SearchResult[];
  error?: string;
}

/**
 * Query the local knowledge base
 */
export async function queryLocalKB(
  question: string,
  options: {
    maxResults?: number;
    includeChunks?: boolean;
  } = {}
): Promise<DocumentQueryResult> {
  try {
    const {
      maxResults = 5,
      includeChunks = true
    } = options;

    // Search knowledge base
    const results = await searchKnowledgeBase(question, {
      limit: maxResults,
      minRelevance: 0.15,
      includeChunks
    });

    if (results.length === 0) {
      return {
        available: true,
        answer: null,
        sources: [],
        error: 'No relevant documentation found for this query.'
      };
    }

    // Synthesize answer from top results
    const answer = synthesizeAnswer(question, results);

    return {
      available: true,
      answer,
      sources: results
    };

  } catch (error) {
    console.error('[Local KB] Query error:', error);
    return {
      available: false,
      answer: null,
      sources: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Synthesize a concise answer from search results
 */
function synthesizeAnswer(question: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant documentation found.';
  }

  // Build answer from top results
  const topResults = results.slice(0, 3);

  const answer = topResults
    .map((result, index) => {
      const prefix = topResults.length > 1 ? `${index + 1}. ` : '';
      return `${prefix}**${result.title}** (${result.type})\n${result.excerpt}`;
    })
    .join('\n\n');

  const summary = topResults.length > 1
    ? `Found ${results.length} relevant document(s):\n\n${answer}`
    : answer;

  return summary;
}

/**
 * Check if local knowledge base is available
 */
export function isLocalKBAvailable(): boolean {
  try {
    // Knowledge base is always available in local mode
    return true;
  } catch {
    return false;
  }
}
