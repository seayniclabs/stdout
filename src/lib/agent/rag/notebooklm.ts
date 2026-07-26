/**
 * NotebookLM Documentation RAG
 *
 * Allows Riggins to search StdOut documentation via NotebookLM.
 * Falls back gracefully when nlm CLI is unavailable (air-gapped, not authenticated).
 */

import { execFileSync } from 'child_process';

const STDOUT_DOCS_NOTEBOOK = process.env.STDOUT_DOCS_NOTEBOOK_ID || 'stdout-docs';
const NLM_TIMEOUT_MS = 30000; // 30s timeout for NotebookLM API

export interface DocsQueryResult {
  answer: string;
  available: boolean;
  error?: string;
}

/**
 * Query StdOut documentation via NotebookLM
 *
 * @param question - Natural language question to ask docs
 * @returns Answer from docs, or empty if unavailable
 */
export async function queryDocs(question: string): Promise<DocsQueryResult> {
  try {
    // Check if nlm CLI is available
    const nlmPath = findNlmBinary();
    if (!nlmPath) {
      return {
        answer: '',
        available: false,
        error: 'nlm CLI not found (install: pipx install notebooklm-mcp-cli)'
      };
    }

    // Execute nlm query
    const result = execFileSync(
      nlmPath,
      ['notebook', 'query', STDOUT_DOCS_NOTEBOOK, question],
      {
        encoding: 'utf-8',
        timeout: NLM_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    // Parse JSON response from nlm
    const parsed = JSON.parse(result);

    return {
      answer: parsed.answer || '',
      available: true
    };
  } catch (error: any) {
    // Log but don't throw - graceful degradation
    console.warn('[RAG:NotebookLM] Query failed:', error.message);

    // Determine error type
    if (error.code === 'ENOENT') {
      return {
        answer: '',
        available: false,
        error: 'nlm CLI not installed'
      };
    }

    if (error.message?.includes('Profile') || error.message?.includes('login')) {
      return {
        answer: '',
        available: false,
        error: 'nlm not authenticated (run: nlm login)'
      };
    }

    if (error.message?.includes('timeout')) {
      return {
        answer: '',
        available: false,
        error: 'NotebookLM API timeout (network issue?)'
      };
    }

    return {
      answer: '',
      available: false,
      error: error.message
    };
  }
}

/**
 * Find nlm binary in common locations
 */
function findNlmBinary(): string | null {
  const paths = [
    '/usr/local/bin/nlm',
    '/home/charlie/.local/bin/nlm',
    '/Users/charlieseay/.local/bin/nlm',
    'nlm' // PATH lookup
  ];

  for (const path of paths) {
    try {
      execFileSync('which', [path], { stdio: 'pipe', timeout: 1000 });
      return path;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Check if NotebookLM RAG is available (for settings UI)
 */
export async function isDocsRAGAvailable(): Promise<boolean> {
  const nlmPath = findNlmBinary();
  if (!nlmPath) return false;

  try {
    // Try a simple notebook list to verify auth
    execFileSync(nlmPath, ['notebook', 'list'], {
      stdio: 'pipe',
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}
