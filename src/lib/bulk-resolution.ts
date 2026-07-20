import { getDb, schema } from './db';
import { eq, and, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Bulk Resolution Service
 *
 * When a fix is verified for one incident, automatically apply it to
 * all open incidents with the same fingerprint.
 *
 * One diagnosis → many resolutions.
 */

export interface BulkResolutionResult {
  /** Primary incident that was resolved */
  primaryIncidentId: string;
  /** Additional incidents resolved with same fix */
  bulkResolvedIds: string[];
  /** Total incidents resolved */
  totalResolved: number;
}

/**
 * After verifying a fix works, apply it to all matching open incidents.
 *
 * Matches on:
 * - Same fingerprint (identical root cause)
 * - Status = active (not already resolved)
 * - Not a duplicate pointer (duplicateOf is null)
 *
 * @param incidentId - The incident that was just resolved
 * @param resolutionContent - The resolution that worked
 * @param userId - User who resolved it
 */
export async function bulkResolveMatching(
  incidentId: string,
  resolutionContent: string,
  userId: string
): Promise<BulkResolutionResult> {
  const db = getDb();
  const now = new Date();

  // Get the resolved incident
  const incident = db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.id, incidentId))
    .get();

  if (!incident || !incident.fingerprint) {
    return {
      primaryIncidentId: incidentId,
      bulkResolvedIds: [],
      totalResolved: 1,
    };
  }

  // Find all open incidents with same fingerprint
  const matchingIncidents = db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.fingerprint, incident.fingerprint),
        eq(schema.incidents.status, 'active'),
        isNull(schema.incidents.duplicateOf) // not duplicate pointers
      )
    )
    .all();

  // Filter out the primary incident
  const othersToResolve = matchingIncidents.filter(i => i.id !== incidentId);

  if (othersToResolve.length === 0) {
    return {
      primaryIncidentId: incidentId,
      bulkResolvedIds: [],
      totalResolved: 1,
    };
  }

  // Bulk resolve all matching incidents
  const resolvedIds: string[] = [];

  for (const other of othersToResolve) {
    // Mark incident as resolved
    db.update(schema.incidents)
      .set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.incidents.id, other.id))
      .run();

    // Add resolution record
    const resolutionId = nanoid();
    db.insert(schema.resolutions)
      .values({
        id: resolutionId,
        incidentId: other.id,
        userId,
        content: `${resolutionContent}\n\n---\n**Note:** This incident was bulk-resolved with incident ${incidentId} (same root cause).`,
        createdAt: now,
      })
      .run();

    resolvedIds.push(other.id);
  }

  return {
    primaryIncidentId: incidentId,
    bulkResolvedIds: resolvedIds,
    totalResolved: 1 + resolvedIds.length,
  };
}

/**
 * When an autofix is verified, check if it applies to other open incidents.
 *
 * Use this in the autofix-exec endpoint after verification succeeds.
 */
export async function checkAndApplyBulkFix(
  incidentId: string,
  fixCommand: string,
  verificationEvidence: string,
  userId: string
): Promise<BulkResolutionResult> {
  const resolutionContent = `## Auto-Fix Applied

**Command:**
\`\`\`bash
${fixCommand}
\`\`\`

## Verification

${verificationEvidence}

**Status:** Verified and applied successfully.`;

  return bulkResolveMatching(incidentId, resolutionContent, userId);
}
