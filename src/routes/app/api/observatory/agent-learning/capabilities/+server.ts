import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const capabilities = {
    nlm_available: false,
    ollama_available: false,
    embedding_model_available: false
  };

  // Check nlm CLI
  try {
    const { isDocsRAGAvailable } = await import('$lib/agent/rag/notebooklm');
    capabilities.nlm_available = await isDocsRAGAvailable();
  } catch {
    capabilities.nlm_available = false;
  }

  // Check Ollama + embedding model
  try {
    const { isIncidentLearningAvailable } = await import('$lib/agent/rag/incident-learning');
    const available = await isIncidentLearningAvailable();
    capabilities.ollama_available = available;
    capabilities.embedding_model_available = available;
  } catch {
    capabilities.ollama_available = false;
    capabilities.embedding_model_available = false;
  }

  return json(capabilities);
};
