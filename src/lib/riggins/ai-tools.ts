/**
 * AI Tool Definitions for Riggins
 *
 * These tools are exposed to Riggins (via tool calling in Anthropic/OpenAI/Gemini)
 * to enable autonomous knowledge base access, markdown reading, and diagram generation.
 */

import { readKnowledgeBaseDoc, searchKnowledgeBase, listDocsByType, findSection, extractCommands } from "./md-reader";
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
  {
    name: "generate_diagram",
    description: "Generate an animated technical diagram using DashMotion. Creates a self-contained HTML/SVG file with animated flows. Supports Flow mode (workflows, state machines) and Architecture mode (systems, components, request paths). Returns path to generated diagram file.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["flow", "architecture"],
          description: "Diagram mode: 'flow' for workflows/pipelines, 'architecture' for system topology with request paths",
        },
        title: {
          type: "string",
          description: "Diagram title (e.g., 'StdOut Discovery Flow', 'Incident Response Workflow')",
        },
        subtitle: {
          type: "string",
          description: "Diagram subtitle providing context",
        },
        nodes: {
          type: "array",
          description: "Array of nodes/components in the diagram",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique node identifier" },
              label: { type: "string", description: "Display label (supports \\n for line breaks)" },
              type: { type: "string", description: "Node type: service, database, gateway, external, queue (architecture); step, decision, start, end (flow)" },
              group: { type: "string", description: "Optional group/boundary this node belongs to (architecture mode)" },
            },
            required: ["id", "label", "type"],
          },
        },
        edges: {
          type: "array",
          description: "Array of connections between nodes",
          items: {
            type: "object",
            properties: {
              from: { type: "string", description: "Source node id" },
              to: { type: "string", description: "Target node id" },
              kind: { type: "string", description: "Connection type: sync, async, auth (architecture); next, yes, no (flow)" },
              label: { type: "string", description: "Optional edge label" },
            },
            required: ["from", "to", "kind"],
          },
        },
        journeys: {
          type: "array",
          description: "Animated request paths (architecture mode only). Each journey shows a colored dot traveling through the system.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Journey name (e.g., 'User Request', 'Discovery Scan')" },
              color: { type: "string", description: "Hex color for the traveling dot (e.g., #34d399)" },
              path: { type: "array", items: { type: "string" }, description: "Array of node ids the dot travels through" },
              begin: { type: "string", description: "Animation start time (e.g., '0s', '1.5s')" },
            },
            required: ["label", "color", "path", "begin"],
          },
        },
        summary: {
          type: "array",
          description: "Summary cards displayed below architecture diagrams (3 cards recommended)",
          items: {
            type: "object",
            properties: {
              accent: { type: "string", enum: ["cyan", "violet", "rose"], description: "Card accent color" },
              title: { type: "string", description: "Card title" },
              items: { type: "array", items: { type: "string" }, description: "Bullet points for this card" },
            },
            required: ["accent", "title", "items"],
          },
        },
        output_filename: {
          type: "string",
          description: "Output filename (e.g., 'discovery-flow.html'). Saved to StdOut public/diagrams/ directory.",
        },
      },
      required: ["mode", "title", "subtitle", "nodes", "edges", "output_filename"],
    },
  },
];

/**
 * Generate an animated diagram using DashMotion
 */
async function generateDiagram(input: any): Promise<any> {
  const {
    mode,
    title,
    subtitle,
    nodes,
    edges,
    journeys,
    summary,
    output_filename,
  } = input;

  // Create semantic graph JSON
  const graph: any = {
    mode,
    title,
    subtitle,
    nodes,
    edges,
  };

  // Add optional fields
  if (journeys && journeys.length > 0) {
    graph.journeys = journeys;
  }
  if (summary && summary.length > 0) {
    graph.summary = summary;
  }

  // Write graph to temp file
  const graphPath = join(tmpdir(), `riggins-diagram-${Date.now()}.json`);
  writeFileSync(graphPath, JSON.stringify(graph, null, 2));

  // Determine output path (StdOut public/diagrams/)
  const outputDir = join(process.cwd(), "public", "diagrams");
  const outputPath = join(outputDir, output_filename);

  try {
    // Create diagrams directory if it doesn't exist
    mkdirSync(outputDir, { recursive: true });

    // Render diagram using DashMotion layout.py
    const dashomotionSkill = join(process.env.HOME || "", ".claude", "skills", "dashmotion");
    const layoutScript = join(dashomotionSkill, "scripts", "layout.py");

    execFileSync(
      "python3",
      [layoutScript, graphPath, "--render", outputPath],
      { encoding: "utf-8" }
    );

    // Validate diagram structure
    const checkScript = join(dashomotionSkill, "scripts", "check_diagram.py");
    const checkResult = execFileSync(
      "python3",
      [checkScript, outputPath],
      { encoding: "utf-8" }
    );

    // Clean up temp file
    unlinkSync(graphPath);

    if (checkResult.includes("PASS")) {
      return {
        success: true,
        path: outputPath,
        url: `/diagrams/${output_filename}`,
        validation: "PASS",
        message: `Diagram generated successfully at ${outputPath}. Access at /diagrams/${output_filename}`,
      };
    } else {
      return {
        success: false,
        error: "Diagram validation failed",
        validation_output: checkResult,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString(),
    };
  }
}

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

    case "generate_diagram":
      return await generateDiagram(toolInput);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
