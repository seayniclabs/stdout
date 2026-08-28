/**
 * Markdown File Reading for Riggins
 * 
 * Enables Riggins to read and parse markdown documentation from the knowledge base,
 * regardless of which AI model is being used (Ollama, Anthropic, OpenAI, Gemini).
 */

import { getDb } from "../db";
import { docs } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Markdown document structure after parsing
 */
export interface MarkdownDoc {
  id: string;
  title: string;
  type: "runbook" | "note" | "guide" | "post-mortem";
  content: string;
  sections: MarkdownSection[];
  tags: string[];
}

/**
 * A section within a markdown document
 */
export interface MarkdownSection {
  heading: string;
  level: number; // 1 = #, 2 = ##, 3 = ###
  content: string;
  codeBlocks: CodeBlock[];
  lists: List[];
}

/**
 * A code block within a section
 */
export interface CodeBlock {
  language: string;
  code: string;
}

/**
 * A list within a section
 */
export interface List {
  type: "ordered" | "unordered";
  items: string[];
}

/**
 * Read a knowledge base document by slug or ID
 */
export async function readKnowledgeBaseDoc(slugOrId: string): Promise<MarkdownDoc | null> {
  const db = getDb();
  
  // Try by slug first, then by ID
  const result = await db.select().from(docs).where(eq(docs.slug, slugOrId)).limit(1);
  if (!result.length) {
    const resultById = await db.select().from(docs).where(eq(docs.id, slugOrId)).limit(1);
    if (!resultById.length) return null;
    return parseMarkdown(resultById[0]);
  }
  
  return parseMarkdown(result[0]);
}

/**
 * Search knowledge base by query string
 */
export async function searchKnowledgeBase(query: string): Promise<MarkdownDoc[]> {
  const db = getDb();
  
  // Simple search: look in title, content, tags
  // FTS5 full-text search: Phase 3 optimization - current LIKE search works
  const results = await db.select().from(docs).all();
  
  const lowerQuery = query.toLowerCase();
  const matches = results.filter(doc => {
    return (
      doc.title.toLowerCase().includes(lowerQuery) ||
      doc.content.toLowerCase().includes(lowerQuery) ||
      doc.tags?.toLowerCase().includes(lowerQuery)
    );
  });
  
  return matches.map(parseMarkdown);
}

/**
 * List all knowledge base documents of a specific type
 */
export async function listDocsByType(type: "runbook" | "note" | "guide" | "post-mortem"): Promise<MarkdownDoc[]> {
  const db = getDb();
  const results = await db.select().from(docs).where(eq(docs.type, type)).all();
  return results.map(parseMarkdown);
}

/**
 * Parse a raw database document into structured MarkdownDoc
 */
function parseMarkdown(raw: any): MarkdownDoc {
  const sections: MarkdownSection[] = [];
  const lines = raw.content.split("\n");
  
  let currentSection: MarkdownSection | null = null;
  let currentContent: string[] = [];
  
  for (const line of lines) {
    // Check if this is a heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      // Save previous section if exists
      if (currentSection) {
        currentSection.content = currentContent.join("\n");
        currentSection.codeBlocks = extractCodeBlocks(currentSection.content);
        currentSection.lists = extractLists(currentSection.content);
        sections.push(currentSection);
      }
      
      // Start new section
      const level = headingMatch[1].length;
      const heading = headingMatch[2];
      currentSection = {
        heading,
        level,
        content: "",
        codeBlocks: [],
        lists: [],
      };
      currentContent = [];
    } else {
      // Accumulate content for current section
      currentContent.push(line);
    }
  }
  
  // Save final section
  if (currentSection) {
    currentSection.content = currentContent.join("\n");
    currentSection.codeBlocks = extractCodeBlocks(currentSection.content);
    currentSection.lists = extractLists(currentSection.content);
    sections.push(currentSection);
  }
  
  return {
    id: raw.id,
    title: raw.title,
    type: raw.type,
    content: raw.content,
    sections,
    tags: raw.tags?.split(",").map((t: string) => t.trim()) || [],
  };
}

/**
 * Extract code blocks from markdown content
 */
function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || "text",
      code: match[2].trim(),
    });
  }
  
  return blocks;
}

/**
 * Extract lists from markdown content
 */
function extractLists(content: string): List[] {
  const lists: List[] = [];
  const lines = content.split("\n");
  
  let currentList: List | null = null;
  
  for (const line of lines) {
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    
    if (orderedMatch || unorderedMatch) {
      const item = (orderedMatch || unorderedMatch)![1];
      const type = orderedMatch ? "ordered" : "unordered";
      
      if (!currentList || currentList.type !== type) {
        // Start new list
        if (currentList) lists.push(currentList);
        currentList = { type, items: [item] };
      } else {
        // Continue current list
        currentList.items.push(item);
      }
    } else if (currentList && line.trim() === "") {
      // Empty line ends the list
      lists.push(currentList);
      currentList = null;
    }
  }
  
  // Save final list
  if (currentList) lists.push(currentList);
  
  return lists;
}

/**
 * Helper: Find a section by heading text (case-insensitive)
 */
export function findSection(doc: MarkdownDoc, headingPattern: string): MarkdownSection | null {
  const lower = headingPattern.toLowerCase();
  return doc.sections.find(s => s.heading.toLowerCase().includes(lower)) || null;
}

/**
 * Helper: Extract all commands from code blocks in a section
 */
export function extractCommands(section: MarkdownSection): string[] {
  return section.codeBlocks
    .filter(b => ["bash", "shell", "sh", "zsh"].includes(b.language))
    .flatMap(b => b.code.split("\n").filter(line => !line.startsWith("#") && line.trim().length > 0));
}
