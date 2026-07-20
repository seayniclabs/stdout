import { createHash } from 'crypto';
import { getDb, schema } from './db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Incident Deduplication Service
 *
 * Implements fingerprinting, time-window dedup, and occurrence tracking.
 */

export interface IncidentInput {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  stackId?: string | null;
  tags?: string | null;
}

export interface DedupResult {
  /** If duplicate: the canonical incident ID. If new: the new incident ID. */
  incidentId: string;
  /** True if this was a duplicate */
  isDuplicate: boolean;
  /** If duplicate: how many total occurrences (including this one) */
  occurrenceCount?: number;
}

/**
 * Generate a fingerprint for an incident.
 *
 * Fingerprint includes:
 * - Normalized title (lowercased, trimmed)
 * - First 500 chars of description (catches root cause, ignores timestamps/IDs)
 * - Stack ID (incidents from different stacks aren't duplicates)
 * - Severity (critical vs medium = different incidents)
 */
export function generateFingerprint(input: IncidentInput): string {
  const normalized = {
    title: input.title.toLowerCase().trim(),
    description: input.description.slice(0, 500).toLowerCase().trim(),
    stackId: input.stackId || '',
    severity: input.severity,
  };

  const payload = JSON.stringify(normalized);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Check if an incident with this fingerprint exists within the time window.
 *
 * @param fingerprint - The incident fingerprint
 * @param windowMinutes - Time window in minutes (default: 60)
 * @returns The canonical incident if found, null otherwise
 */
function findCanonicalIncident(
  fingerprint: string,
  windowMinutes: number = 60
): typeof schema.incidents.$inferSelect | null {
  const db = getDb();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  // Find non-duplicate incident with this fingerprint created within window
  const canonical = db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.fingerprint, fingerprint),
        isNull(schema.incidents.duplicateOf), // only find canonical incidents
        gte(schema.incidents.createdAt, windowStart)
      )
    )
    .get();

  return canonical || null;
}

/**
 * Create or deduplicate an incident.
 *
 * If an incident with the same fingerprint exists within the time window,
 * this increments the occurrence count and records the duplicate arrival time.
 *
 * Otherwise, creates a new incident.
 */
export function createOrDeduplicateIncident(
  userId: string,
  input: IncidentInput,
  windowMinutes: number = 60
): DedupResult {
  const db = getDb();
  const fingerprint = generateFingerprint(input);
  const canonical = findCanonicalIncident(fingerprint, windowMinutes);

  if (canonical) {
    // Duplicate detected — increment occurrence count
    const newOccurrenceCount = (canonical.occurrenceCount || 1) + 1;

    db.update(schema.incidents)
      .set({
        occurrenceCount: newOccurrenceCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.incidents.id, canonical.id))
      .run();

    // Record this occurrence
    db.insert(schema.incidentOccurrences)
      .values({
        id: nanoid(),
        incidentId: canonical.id,
        occurredAt: new Date(),
      })
      .run();

    return {
      incidentId: canonical.id,
      isDuplicate: true,
      occurrenceCount: newOccurrenceCount,
    };
  }

  // New incident — create it
  const id = nanoid();
  const now = new Date();

  db.insert(schema.incidents)
    .values({
      id,
      userId,
      stackId: input.stackId || null,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: 'active',
      tags: input.tags || null,
      fingerprint,
      duplicateOf: null,
      occurrenceCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Record first occurrence
  db.insert(schema.incidentOccurrences)
    .values({
      id: nanoid(),
      incidentId: id,
      occurredAt: now,
    })
    .run();

  return {
    incidentId: id,
    isDuplicate: false,
  };
}

/**
 * Get occurrence timeline for an incident.
 * Returns all timestamps when this incident (or its duplicates) occurred.
 */
export function getOccurrenceTimeline(incidentId: string): Date[] {
  const db = getDb();

  const occurrences = db
    .select()
    .from(schema.incidentOccurrences)
    .where(eq(schema.incidentOccurrences.incidentId, incidentId))
    .orderBy(schema.incidentOccurrences.occurredAt)
    .all();

  return occurrences.map(o => new Date(o.occurredAt));
}
