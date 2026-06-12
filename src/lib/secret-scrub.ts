/**
 * Deterministic secret + PII scrub (Charlie 2026-06-12).
 *
 * The NON-NEGOTIABLE floor for every document write. Sensitive data is treated like PII: no
 * secrets, passwords, tokens, keys, IPs, or hostnames survive into a stored doc. This runs with
 * ZERO LLM dependency — pure regex — so it works even when no model is available, and it runs
 * BEFORE any LLM generalization (defense in depth: never trust an LLM as the only thing standing
 * between a secret and disk).
 *
 *   internal docs  → scrub secrets/credentials/keys/tokens (lenient: hostnames/IPs/paths kept).
 *   community docs → scrub EVERYTHING (secrets + IPs + hostnames + emails + paths), then the LLM
 *                    sanitizer generalizes the rest and screens accuracy/appropriateness.
 *
 * This is intentionally aggressive about credentials and conservative about false-positives on
 * benign technical content (it redacts the VALUE, keeping the key name so the doc still reads).
 */

export type ScrubLevel = 'internal' | 'community';

export interface ScrubReplacement {
  category: string;
  count: number;
}

export interface ScrubResult {
  content: string;
  title: string;
  replacements: ScrubReplacement[];
  /** true if anything sensitive (credential-class) was found — useful for audit/alerting. */
  foundSecrets: boolean;
}

interface Rule {
  category: string;
  re: RegExp;
  replace: string | ((m: string, ...g: string[]) => string);
  /** credential-class rules set foundSecrets even at internal level. */
  secret?: boolean;
  /** only applied at community level (org-identifying, not strictly secret). */
  communityOnly?: boolean;
}

// Order matters: most specific first so a key=value rule wins before a bare-token rule.
const RULES: Rule[] = [
  // ── Credential-class (always scrubbed, both levels) ──────────────────────────
  // key: value / key=value where the key implies a secret. Redacts the VALUE, keeps the key.
  {
    category: 'credential_assignment',
    secret: true,
    re: /\b(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|priv(?:ate)?[_-]?key|client[_-]?secret|auth|bearer|credential|passphrase)\b(\s*[:=]\s*|\s+is\s+)(['"]?)([^\s'"]{4,})\3/gi,
    replace: (_m, key, sep) => `${key}${sep}<redacted>`,
  },
  // Authorization: Bearer <jwt/opaque>
  {
    category: 'auth_header',
    secret: true,
    re: /\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._\-+/=]{8,}/gi,
    replace: (_m, p) => `${p}<redacted>`,
  },
  // JWTs (three base64url segments)
  {
    category: 'jwt',
    secret: true,
    re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    replace: '<redacted-jwt>',
  },
  // Common provider key shapes
  {
    category: 'provider_key',
    secret: true,
    re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g,
    replace: '<redacted-key>',
  },
  // PEM private-key blocks
  {
    category: 'private_key_block',
    secret: true,
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    replace: '<redacted-private-key>',
  },
  // Connection strings with inline credentials: proto://user:pass@host
  {
    category: 'connection_string_creds',
    secret: true,
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s:/@]+)@/gi,
    replace: (_m, proto, user) => `${proto}${user}:<redacted>@`,
  },

  // ── Community-only (org-identifying, scrubbed for public submissions) ─────────
  {
    category: 'email',
    communityOnly: true,
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: '<email>',
  },
  {
    category: 'ipv4',
    communityOnly: true,
    // Skip obvious doc/example ranges? No — community scrub is aggressive; redact all.
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    replace: '<ip>',
  },
  {
    category: 'hostname_fqdn',
    communityOnly: true,
    // FQDNs (something.tld) — keep common public tech domains out by requiring 2+ dots OR a private-ish tld
    re: /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|home|corp|seaynicroute\.com)\b/gi,
    replace: '<hostname>',
  },
  {
    category: 'home_path',
    communityOnly: true,
    re: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g,
    replace: '/home/<user>',
  },
];

function applyRule(text: string, rule: Rule): { text: string; count: number } {
  let count = 0;
  const out = text.replace(rule.re, (...args: any[]) => {
    count++;
    return typeof rule.replace === 'function'
      ? (rule.replace as any)(...args)
      : rule.replace;
  });
  return { text: out, count };
}

/**
 * Deterministically scrub a title + content. Always strips credential-class data; at community
 * level additionally strips org-identifying data (emails, IPs, internal hostnames, home paths).
 */
export function scrubSecrets(opts: {
  title: string;
  content: string;
  level: ScrubLevel;
}): ScrubResult {
  const replacements: ScrubReplacement[] = [];
  let foundSecrets = false;
  let title = opts.title;
  let content = opts.content;

  for (const rule of RULES) {
    if (rule.communityOnly && opts.level !== 'community') continue;
    const t = applyRule(title, rule);
    const c = applyRule(content, rule);
    const total = t.count + c.count;
    if (total > 0) {
      title = t.text;
      content = c.text;
      replacements.push({ category: rule.category, count: total });
      if (rule.secret) foundSecrets = true;
    }
  }

  return { title, content, replacements, foundSecrets };
}
