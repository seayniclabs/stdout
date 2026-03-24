/**
 * Value scoring for community knowledge base contributions.
 * Rule-based checks that determine whether a doc meets the quality bar.
 * Returns a score 0-100 and specific reasons for rejection.
 */

export interface ValueScoreResult {
  score: number;
  passed: boolean;
  reasons: string[];
}

const MIN_CONTENT_LENGTH = 200;
const MIN_SCORE = 50;

export function scoreSubmission(opts: {
  title: string;
  content: string;
  docType: string;
}): ValueScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // --- Content length (0-20 points) ---
  const contentLength = opts.content.length;
  if (contentLength < MIN_CONTENT_LENGTH) {
    reasons.push(`Content too short (${contentLength} chars, min ${MIN_CONTENT_LENGTH})`);
  } else if (contentLength < 500) {
    score += 10;
  } else if (contentLength < 1500) {
    score += 15;
  } else {
    score += 20;
  }

  // --- Structure (0-25 points) ---
  const hasHeadings = /^##?\s+/m.test(opts.content);
  const hasCodeBlock = /```[\s\S]*?```/.test(opts.content);
  const hasBullets = /^[-*]\s+/m.test(opts.content);

  if (hasHeadings) score += 10;
  else reasons.push('No section headings (## Pattern, ## Fix, etc.)');

  if (hasCodeBlock) score += 10;
  if (hasBullets) score += 5;

  // --- Actionability (0-25 points) ---
  const contentLower = opts.content.toLowerCase();

  // Check for root cause / diagnosis section
  const hasRootCause = /root\s*cause|why\s+this\s+happens|cause[ds]?\s+by/i.test(opts.content);
  if (hasRootCause) score += 10;
  else reasons.push('No identifiable root cause explanation');

  // Check for fix / resolution section
  const hasFix = /## fix|## solution|## resolution|## prevention|how to fix/i.test(opts.content);
  if (hasFix) score += 10;
  else reasons.push('No fix/resolution section');

  // Check for symptoms section
  const hasSymptoms = /## symptoms|## signs|you.ll see|shows as|appears as/i.test(opts.content);
  if (hasSymptoms) score += 5;

  // --- Specificity (0-15 points) ---
  // Penalize vague restarts-only fixes
  const isJustRestart = /^(just |simply )?(restart|reboot)/im.test(opts.content) && contentLength < 400;
  if (isJustRestart) {
    reasons.push('Fix appears to be only "restart" without deeper analysis');
  } else {
    score += 10;
  }

  // Check for specific technology references
  const techTerms = ['docker', 'nginx', 'postgres', 'redis', 'node', 'ssl', 'dns', 'oom', 'wal',
    'compose', 'kubernetes', 'systemd', 'cron', 'backup', 'certificate', 'proxy', 'firewall',
    'memory', 'cpu', 'disk', 'network', 'timeout', 'connection', 'permission', 'auth'];
  const techMatches = techTerms.filter(t => contentLower.includes(t));
  if (techMatches.length >= 3) score += 5;
  else if (techMatches.length >= 1) score += 3;

  // --- Title quality (0-15 points) ---
  if (opts.title.length > 20 && opts.title.length < 100) score += 10;
  else if (opts.title.length >= 10) score += 5;
  else reasons.push('Title too short or too long');

  // Descriptive title (not just "Fix" or "Bug")
  const titleWords = opts.title.split(/\s+/).length;
  if (titleWords >= 4) score += 5;

  return {
    score: Math.min(score, 100),
    passed: score >= MIN_SCORE && contentLength >= MIN_CONTENT_LENGTH,
    reasons,
  };
}
