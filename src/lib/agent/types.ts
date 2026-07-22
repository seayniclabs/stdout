/**
 * Observatory Agent Type Definitions
 */

export interface AgentConfig {
  id: string;
  userId: string;
  provider: 'ollama' | 'anthropic-cli' | 'anthropic-api' | 'gemini' | 'openai' | 'custom';
  endpoint?: string; // For Ollama/custom
  model: string;
  apiKey?: string;
  enabled: boolean;
  proactiveNotifications: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    toolCalls?: Array<{ tool: string; params: any; result: any }>;
    model?: string;
    tokens?: { prompt: number; completion: number };
    degraded?: boolean;
  };
  createdAt: Date;
}
