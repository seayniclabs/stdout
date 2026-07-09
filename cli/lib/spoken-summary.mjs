/**
 * Pure helpers for voice-friendly incident summaries (BB15).
 * Keep in sync with src/lib/comms/spoken-summary.ts
 */

export const MAX_SPOKEN_WORDS = 45;

export function clipToSpoken(text, maxWords = MAX_SPOKEN_WORDS) {
  const cleaned = text
    .replace(/[`*_#>\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  if (words.length <= maxWords) return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
  const clipped = words.slice(0, maxWords).join(' ').replace(/[,:;]+$/, '');
  return `${clipped}.`;
}

export function formatSpokenSummary(opts = {}) {
  const parts = [];

  const topCause = opts.rootCauses?.find((c) => c?.trim());
  if (topCause) {
    parts.push(clipToSpoken(topCause, 28).replace(/\.$/, ''));
  } else if (opts.health) {
    const h = opts.health;
    if (h.services_down > 0) {
      parts.push(`${h.services_down} service${h.services_down === 1 ? '' : 's'} down`);
    } else if (h.services_degraded > 0) {
      parts.push(`${h.services_degraded} service${h.services_degraded === 1 ? '' : 's'} degraded`);
    } else if (h.services_total > 0) {
      parts.push(`All ${h.services_healthy} services healthy`);
    }
  }

  const open = (opts.incidents || []).filter((i) => !i.resolved);
  if (open.length > 0 && !topCause) {
    const titles = open
      .slice(0, 2)
      .map((i) => i.title)
      .join('; ');
    parts.push(`${open.length} open incident${open.length === 1 ? '' : 's'}: ${titles}`);
  }

  const cmd = opts.suggestedCommands?.find((c) => c?.trim());
  if (cmd && parts.length > 0) {
    const shortCmd = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
    parts.push(`Try ${shortCmd}`);
  }

  if (parts.length === 0) {
    return "I couldn't diagnose that yet. Check open incidents in StdOut.";
  }

  return clipToSpoken(parts.join('. '), MAX_SPOKEN_WORDS);
}
