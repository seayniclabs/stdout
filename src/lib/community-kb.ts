import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { getDb, schema } from './db';
import { nanoid } from 'nanoid';

export const COMMUNITY_SYNC_URL = 'https://stdout.seayniclabs.com/library/api/sync';
const FETCH_TIMEOUT_MS = 10_000;

interface RemoteDoc {
  id: string;
  title: string;
  content: string;
  docType: 'runbook' | 'postmortem' | 'guide' | 'note';
  tags: string | null;
  version: number;
  publishedAt: number;
}

interface SyncResponse {
  docs: RemoteDoc[];
  withdrawn: string[];
  syncVersion: number;
}

export interface SyncSummary {
  added: number;
  updated: number;
  removed: number;
  syncVersion: number;
  skipped: boolean;
  error?: string;
}

function getLastSyncedVersion(workspaceUserId: string): number {
  const db = getDb();
  const row = db.select({ v: max(schema.docs.communityVersion) })
    .from(schema.docs)
    .where(eq(schema.docs.source, 'community'))
    .get();
  return row?.v ?? 0;
}

async function fetchRemoteSync(sinceVersion: number): Promise<SyncResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${COMMUNITY_SYNC_URL}?since_version=${sinceVersion}`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`sync host returned ${res.status}`);
    return await res.json() as SyncResponse;
  } finally {
    clearTimeout(t);
  }
}

export async function syncCommunityLibrary(workspaceUserId: string): Promise<SyncSummary> {
  let added = 0, updated = 0, removed = 0;
  const sinceVersion = getLastSyncedVersion(workspaceUserId);

  let payload: SyncResponse;
  try {
    payload = await fetchRemoteSync(sinceVersion);
  } catch (err) {
    return {
      added: 0, updated: 0, removed: 0,
      syncVersion: sinceVersion, skipped: true,
      error: err instanceof Error ? err.message : 'fetch failed',
    };
  }

  const db = getDb();
  const now = new Date();

  // Fixed N+1: Load all existing community docs once instead of per-doc
  const existingDocs = db.select().from(schema.docs)
    .where(eq(schema.docs.source, 'community'))
    .all();

  const existingMap = new Map(
    existingDocs.map(d => [d.communityDocId, d])
  );

  // Process in transaction for atomicity
  db.transaction(() => {
    for (const doc of payload.docs) {
      const existing = existingMap.get(doc.id);

      if (existing) {
        if ((existing.communityVersion ?? 0) < doc.version) {
          db.update(schema.docs).set({
            title: doc.title,
            content: doc.content,
            docType: doc.docType,
            tags: doc.tags,
            sizeBytes: doc.content.length,
            communityVersion: doc.version,
            updatedAt: now,
          }).where(eq(schema.docs.id, existing.id)).run();
          updated++;
        }
    } else {
      db.insert(schema.docs).values({
        id: nanoid(),
        userId: workspaceUserId,
        title: doc.title,
        content: doc.content,
        docType: doc.docType,
        tags: doc.tags,
        sizeBytes: doc.content.length,
        source: 'community',
        communityDocId: doc.id,
        communityVersion: doc.version,
        createdAt: new Date(doc.publishedAt),
        updatedAt: now,
      }).run();
      added++;
    }
    }
  });

  // Fixed N+1: Batch delete withdrawn docs instead of one-by-one
  if (payload.withdrawn.length > 0) {
    const r = db.delete(schema.docs)
      .where(and(
        inArray(schema.docs.communityDocId, payload.withdrawn),
        eq(schema.docs.source, 'community'),
      )).run();
    removed += r.changes ?? 0;
  }

  return {
    added, updated, removed,
    syncVersion: payload.syncVersion,
    skipped: false,
  };
}
