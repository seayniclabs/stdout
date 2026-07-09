/**
 * Voice incident analysis (BB15)
 *
 * Turns a free-form incident query into AI diagnosis + a speakable summary
 * for Sonique / CLI TTS playback.
 */

import { getDb, schema } from '../db';
import { eq } from 'drizzle-orm';
import { diagnoseIncident, type DiagnosisResult } from '../diagnose';
import {
  getSystemHealth,
  getRecentIncidents,
  getStacksSummary,
  type SystemHealthSummary,
  type RecentIncident,
} from './queries';
import { formatSpokenSummary } from './spoken-summary';

export { formatSpokenSummary, clipToSpoken } from './spoken-summary';

export interface VoiceIncidentContext {
  health: SystemHealthSummary;
  incidents: RecentIncident[];
  stacks: { total: number; names: string[] };
  stackContext: string;
  pastResolutions: string[];
  dataSources: Array<{ type: string; name: string; enabled: boolean }>;
}

export interface VoiceIncidentResult {
  query: string;
  spoken_summary: string;
  response: string;
  rootCauses: string[];
  suggestedCommands: string[];
  model: string | null;
  metadata: {
    health: SystemHealthSummary;
    open_incidents: number;
    stacks: string[];
    ai: boolean;
  };
}

export async function loadVoiceIncidentContext(userId: string): Promise<VoiceIncidentContext> {
  const db = getDb();

  const [health, incidents, stacks] = await Promise.all([
    getSystemHealth(userId),
    getRecentIncidents(userId, 5),
    getStacksSummary(userId),
  ]);

  const userStacks = db
    .select()
    .from(schema.stacks)
    .where(eq(schema.stacks.userId, userId))
    .all();

  const stackContext =
    userStacks.length > 0
      ? userStacks
          .map((s) => `${s.name}: ${s.description || 'no description'}`)
          .join('\n')
      : 'No stack description provided.';

  const pastResolutions: string[] = [];
  try {
    const rawDb = (db as { $client?: { prepare: (sql: string) => { all: (...args: unknown[]) => Array<{ content?: string }> } } }).$client;
    if (rawDb?.prepare) {
      const rows = rawDb
        .prepare(
          `SELECT r.content FROM resolutions r
           JOIN incidents i ON r.incident_id = i.id
           WHERE i.user_id = ?
           ORDER BY r.created_at DESC LIMIT 3`,
        )
        .all(userId);
      for (const row of rows) {
        if (row.content) pastResolutions.push(row.content);
      }
    }
  } catch {
    /* resolutions table may be empty */
  }

  let dataSources: VoiceIncidentContext['dataSources'] = [];
  try {
    const allSources = db
      .select()
      .from(schema.dataSources)
      .where(eq(schema.dataSources.userId, userId))
      .all();
    dataSources = allSources.map((s) => ({
      type: s.type,
      name: s.name,
      enabled: !!s.enabled,
    }));
  } catch {
    /* data sources optional */
  }

  return { health, incidents, stacks, stackContext, pastResolutions, dataSources };
}

async function resolveCredential(userId: string): Promise<{
  tier: 'free' | 'paid';
  apiKey?: string;
  model?: string;
  provider?: string;
} | null> {
  const db = getDb();
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;

  const { getUserLimits } = await import('../tiers');
  const { limits } = getUserLimits(user);
  const tier = limits.aiModel === 'sonnet' ? 'paid' : 'free';

  try {
    const { resolveForDiagnostics } = await import('../ai-providers');
    const credential = resolveForDiagnostics(userId, tier);
    if (!credential) return { tier, provider: 'ollama' };
    return {
      tier,
      apiKey: credential.source === 'user_key' ? credential.apiKey : undefined,
      model: credential.model,
      provider: credential.provider,
    };
  } catch {
    return { tier, provider: 'ollama' };
  }
}

/**
 * Full voice-incident pipeline: live context → AI diagnosis → spoken summary.
 */
export async function analyzeVoiceIncident(
  userId: string,
  query: string,
): Promise<VoiceIncidentResult> {
  const q = query.trim();
  if (!q) {
    throw new Error('Query text is required');
  }

  const ctx = await loadVoiceIncidentContext(userId);
  let diagnosis: DiagnosisResult | null = null;
  let ai = false;

  const cred = await resolveCredential(userId);
  if (cred) {
    try {
      diagnosis = await diagnoseIncident({
        stackContext: ctx.stackContext,
        incidentDescription: q,
        pastResolutions: ctx.pastResolutions,
        tier: cred.tier,
        dataSources: ctx.dataSources,
        apiKey: cred.apiKey,
        model: cred.model,
        provider: cred.provider,
      });
      ai = true;
    } catch (err) {
      console.warn('[voice-incident] AI diagnosis failed, using context-only summary:', err);
    }
  }

  const spoken_summary = formatSpokenSummary({
    rootCauses: diagnosis?.rootCauses,
    suggestedCommands: diagnosis?.suggestedCommands,
    health: ctx.health,
    incidents: ctx.incidents,
    query: q,
  });

  const responseParts: string[] = [spoken_summary];
  if (diagnosis?.rootCauses?.length) {
    responseParts.push(
      '',
      'Root causes:',
      ...diagnosis.rootCauses.map((c, i) => `${i + 1}. ${c}`),
    );
  }
  if (diagnosis?.suggestedCommands?.length) {
    responseParts.push(
      '',
      'Suggested commands:',
      ...diagnosis.suggestedCommands.map((c) => `- ${c}`),
    );
  }

  return {
    query: q,
    spoken_summary,
    response: responseParts.join('\n'),
    rootCauses: diagnosis?.rootCauses || [],
    suggestedCommands: diagnosis?.suggestedCommands || [],
    model: diagnosis?.model || null,
    metadata: {
      health: ctx.health,
      open_incidents: ctx.incidents.filter((i) => !i.resolved).length,
      stacks: ctx.stacks.names,
      ai,
    },
  };
}
