import { and, desc, eq, max } from 'drizzle-orm';
import { getTenantDb, tenantSchema } from './db';
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
  const db = getTenantDb(workspaceUserId);
  const row = db.select({ v: max(tenantSchema.docs.communityVersion) })
    .from(tenantSchema.docs)
    .where(eq(tenantSchema.docs.source, 'community'))
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

  const db = getTenantDb(workspaceUserId);
  const now = new Date();

  for (const doc of payload.docs) {
    const existing = db.select().from(tenantSchema.docs)
      .where(and(
        eq(tenantSchema.docs.communityDocId, doc.id),
        eq(tenantSchema.docs.source, 'community'),
      )).get();

    if (existing) {
      if ((existing.communityVersion ?? 0) < doc.version) {
        db.update(tenantSchema.docs).set({
          title: doc.title,
          content: doc.content,
          docType: doc.docType,
          tags: doc.tags,
          sizeBytes: doc.content.length,
          communityVersion: doc.version,
          updatedAt: now,
        }).where(eq(tenantSchema.docs.id, existing.id)).run();
        updated++;
      }
    } else {
      db.insert(tenantSchema.docs).values({
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

  for (const id of payload.withdrawn) {
    const r = db.delete(tenantSchema.docs)
      .where(and(
        eq(tenantSchema.docs.communityDocId, id),
        eq(tenantSchema.docs.source, 'community'),
      )).run();
    removed += r.changes ?? 0;
  }

  return {
    added, updated, removed,
    syncVersion: payload.syncVersion,
    skipped: false,
  };
}
