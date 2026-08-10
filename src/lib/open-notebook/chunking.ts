/**
 * Document Chunking Pipeline
 *
 * Phase 3.1: Open-Notebook Local RAG
 *
 * Semantic chunking for context retrieval:
 * - Splits documents into semantically meaningful chunks
 * - Preserves context boundaries (paragraphs, sections)
 * - Optimized for RAG retrieval (512-1024 chars per chunk)
 * - Maintains chunk overlap for continuity
 */

export interface Chunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

export interface ChunkingOptions {
  maxChunkSize?: number;      // Max characters per chunk (default: 800)
  minChunkSize?: number;      // Min characters per chunk (default: 200)
  overlap?: number;           // Characters to overlap between chunks (default: 100)
  preserveStructure?: boolean; // Try to split on semantic boundaries (default: true)
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  maxChunkSize: 800,
  minChunkSize: 200,
  overlap: 100,
  preserveStructure: true,
};

/**
 * Chunk a document into semantically meaningful segments
 */
export function chunkDocument(
  content: string,
  options: ChunkingOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];

  if (!content || content.trim().length === 0) {
    return chunks;
  }

  // Split on semantic boundaries (paragraphs, sections)
  const segments = opts.preserveStructure
    ? splitOnSemanticBoundaries(content)
    : [content];

  let currentChunk = '';
  let currentStartOffset = 0;
  let chunkIndex = 0;

  for (const segment of segments) {
    // If segment alone is too large, split it further
    if (segment.length > opts.maxChunkSize) {
      // Flush current chunk if it exists
      if (currentChunk.length > 0) {
        chunks.push({
          index: chunkIndex++,
          content: currentChunk.trim(),
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + currentChunk.length,
        });
        currentChunk = '';
      }

      // Split large segment into smaller chunks
      const subChunks = splitLargeSegment(segment, opts.maxChunkSize, opts.overlap);
      for (const subChunk of subChunks) {
        chunks.push({
          index: chunkIndex++,
          content: subChunk.trim(),
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + subChunk.length,
        });
        currentStartOffset += subChunk.length - opts.overlap;
      }
      continue;
    }

    // Try to add segment to current chunk
    const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + segment;

    if (testChunk.length <= opts.maxChunkSize) {
      currentChunk = testChunk;
    } else {
      // Current chunk is full, flush it
      if (currentChunk.length >= opts.minChunkSize) {
        chunks.push({
          index: chunkIndex++,
          content: currentChunk.trim(),
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + currentChunk.length,
        });

        // Start new chunk with overlap
        const overlapText = getOverlapText(currentChunk, opts.overlap);
        currentChunk = overlapText + '\n\n' + segment;
        currentStartOffset += currentChunk.length - opts.overlap;
      } else {
        // Current chunk too small, keep adding
        currentChunk = testChunk;
      }
    }
  }

  // Flush final chunk
  if (currentChunk.trim().length >= opts.minChunkSize) {
    chunks.push({
      index: chunkIndex++,
      content: currentChunk.trim(),
      startOffset: currentStartOffset,
      endOffset: currentStartOffset + currentChunk.length,
    });
  }

  return chunks;
}

/**
 * Split document on semantic boundaries (paragraphs, headings, lists)
 */
function splitOnSemanticBoundaries(content: string): string[] {
  // Split on double newlines (paragraphs), headings, or horizontal rules
  const segments: string[] = [];

  // Match markdown headings, lists, code blocks, and paragraph breaks
  const lines = content.split('\n');
  let currentSegment: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if line is a semantic boundary
    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isHorizontalRule = /^[-*_]{3,}$/.test(trimmed);
    const isListItem = /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
    const isCodeFence = /^```/.test(trimmed);
    const isEmptyLine = trimmed.length === 0;

    // Flush current segment on semantic boundaries
    if ((isHeading || isHorizontalRule || isCodeFence) && currentSegment.length > 0) {
      segments.push(currentSegment.join('\n').trim());
      currentSegment = [];
    }

    // Add line to current segment
    currentSegment.push(line);

    // Flush on double newline (paragraph break)
    if (isEmptyLine && currentSegment.length > 1) {
      const segmentText = currentSegment.join('\n').trim();
      if (segmentText.length > 0) {
        segments.push(segmentText);
      }
      currentSegment = [];
    }
  }

  // Flush final segment
  if (currentSegment.length > 0) {
    const segmentText = currentSegment.join('\n').trim();
    if (segmentText.length > 0) {
      segments.push(segmentText);
    }
  }

  return segments.filter(s => s.length > 0);
}

/**
 * Split a large segment into smaller chunks
 */
function splitLargeSegment(
  segment: string,
  maxSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < segment.length) {
    const end = Math.min(start + maxSize, segment.length);
    const chunk = segment.substring(start, end);
    chunks.push(chunk);
    start = end - overlap;
  }

  return chunks;
}

/**
 * Get last N characters for overlap between chunks
 */
function getOverlapText(text: string, overlapSize: number): string {
  if (text.length <= overlapSize) {
    return text;
  }

  // Try to find a sentence boundary within overlap region
  const overlapText = text.substring(text.length - overlapSize);
  const sentenceBoundary = overlapText.search(/[.!?]\s+/);

  if (sentenceBoundary !== -1) {
    return overlapText.substring(sentenceBoundary + 1).trim();
  }

  return overlapText.trim();
}

/**
 * Merge chunks back into original document (for testing)
 */
export function mergeChunks(chunks: Chunk[]): string {
  return chunks.map(c => c.content).join('\n\n');
}
