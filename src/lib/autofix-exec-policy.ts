/**
 * Auto-Fix command policy — keep aligned with Windlass `execute_command` (allowlist + blocks).
 * All execution paths (Windlass /exec and any local fallback) must pass this gate first.
 */

/** Lowercase prefixes — must match Windlass EXEC_ALLOWED_PREFIXES order/meaning. */
export const AUTOFIX_ALLOWED_PREFIXES = [
  'docker ',
  'docker-compose ',
  'curl ',
  'dig ',
  'nslookup ',
  'ping ',
  'netstat ',
  'ss ',
  'openssl ',
  'cat /',
] as const;

/** Reject shell chaining / substitution and token-splitting bypasses of naive substring checks. */
export function assertAutofixCommandAllowed(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'Empty command';

  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) return 'Command blocked: control characters are not allowed';
  if (/[\n\r]/.test(command)) return 'Command blocked: newlines are not allowed';

  if (trimmed.includes('&&') || trimmed.includes('||')) {
    return 'Command blocked: command chaining (&& or ||) is not allowed';
  }

  if (/[;|$\x60]/.test(command)) return 'Command blocked: shell metacharacters are not allowed';

  const norm = trimmed.replace(/\s+/g, ' ').toLowerCase();

  const blockedRes = [
    /\brm\b[\s\S]{0,200}?(-rf|--recursive|-r\s+-f)\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /:\(\)\{/,
    /\bchmod\b[\s\S]{0,120}?\b777\b/,
    />\s*\/dev\/(sd|hd|nvme|disk)/,
    /\|\s*(ba)?sh\b/,
    /\bcurl\b[\s\S]{0,400}?\|\s*(ba)?sh\b/,
    /\bwget\b[\s\S]{0,400}?\|\s*(ba)?sh\b/,
  ];
  for (const re of blockedRes) {
    if (re.test(norm)) return 'Command blocked by safety policy';
  }

  const legacy = [':(){:|:&};:', 'rm -rf /', 'rm -fr /', 'chmod -r 777 /'];
  if (legacy.some(b => norm.includes(b))) return 'Command blocked by safety policy';

  const lowered = trimmed.toLowerCase();
  const allowed = AUTOFIX_ALLOWED_PREFIXES.some(p => lowered.startsWith(p));
  if (!allowed) {
    return `Command blocked: not an allowed diagnostic prefix (${AUTOFIX_ALLOWED_PREFIXES.map(p => p.trim()).join(', ')})`;
  }

  return null;
}
