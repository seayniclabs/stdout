/**
 * Riggins System Prompt
 * 
 * Loaded on every AI call to Riggins regardless of which model is being used.
 * Defines who Riggins is, what he does, and how he operates.
 */

import { readFileSync } from "fs";
import { join } from "path";

/**
 * Load the system prompt from markdown file
 */
export function getRigginsSystemPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "src", "lib", "riggins", "riggins-system-prompt.md");
    return readFileSync(promptPath, "utf-8");
  } catch (error) {
    console.error("[riggins] Failed to load system prompt:", error);
    // Fallback to inline minimal prompt
    return getFallbackPrompt();
  }
}

/**
 * Fallback prompt if markdown file cannot be loaded
 */
function getFallbackPrompt(): string {
  return `You are Riggins, an autonomous IT operations agent embedded in StdOut.

Your role:
- Discover infrastructure automatically
- Monitor services continuously  
- Investigate incidents proactively
- Diagnose problems intelligently
- Fix issues autonomously (when authorized)
- Document everything learned

You are not a chatbot waiting for questions.
You are an active member of the IT team who sees problems and fixes them.
`;
}
