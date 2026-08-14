/**
 * AI Tool Definitions for Riggins
 * 
 * These tools are exposed to Riggins (via tool calling in Anthropic/OpenAI/Gemini)
 * to enable autonomous knowledge base access and markdown reading.
 */

import { readKnowledgeBaseDoc, searchKnowledgeBase, listDocsByType, findSection, extractCommands } from "./md-reader";

/**
 * Tool definitions in Anthropic tool-calling format
 * (compatible with OpenAI function calling and Gemini function declarations)
 */
export const RIGGINS_TOOLS = [
  {
    name: "read_knowledge_base_doc",
    description: "Read a document from the knowledge base by slug or ID. Returns full parsed markdown with sections, code blocks, and lists.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug_or_id: {
          type: "string",
          description: "Document slug (e.g., docker-high-cpu) or ID",
        },
      },
      required: ["slug_or_id"],
    },
  },
  {
    name: "search_knowledge_base",
    description: "Search the knowledge base for documents matching a query. Returns array of matching documents.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (searches title, content, tags)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_docs_by_type",
    description: "List all documents of a specific type (runbook, guide, post-mortem, note)",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["runbook", "guide", "post-mortem", "note"],
          description: "Document type to list",
        },
      },
      required: ["type"],
    },
  },
];

/**
 * Execute a tool call from the AI
 */
export async function executeRigginsTool(toolName: string, toolInput: any): Promise<any> {
  switch (toolName) {
    case "read_knowledge_base_doc":
      return await readKnowledgeBaseDoc(toolInput.slug_or_id);
    
    case "search_knowledge_base":
      return await searchKnowledgeBase(toolInput.query);
    
    case "list_docs_by_type":
      return await listDocsByType(toolInput.type);
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
