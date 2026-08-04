// ============================================================================
// UNIFIED SCHEMA FOR SELF-HOSTED StdOut
// ============================================================================
// This file re-exports all table definitions from modular schema files.
// No tables are defined here directly - all definitions live in their
// respective schema files by domain.
//
// Schema organization:
// - setup-schema.ts: license, setup, system state, audit
// - central-schema.ts: users, sessions, API tokens
// - monitoring-schema.ts: stacks, monitors, incidents, diagnoses
// - observatory-schema.ts: baselines, patterns, agent runs, feedback
// - agent-schema.ts: agent config, conversations
// - tenant-schema.ts: multi-tenant tables (tickets, docs, alerts, etc.)
// - satellite-schema.ts: satellite agents and reports
// - entities-schema.ts: entity graph (hosts, containers, services)
// - skins-schema.ts: theming and UI customization
// - collectors-schema.ts: data collector configs and events
// - cost-schema.ts: LLM cost tracking
// - community-schema.ts: community library submissions
// ============================================================================

export * from './setup-schema';
export * from './central-schema';
export * from './monitoring-schema';
export * from './observatory-schema';
export * from './agent-schema';
export * from './tenant-schema';
export * from './satellite-schema';
export * from './entities-schema';
export * from './skins-schema';
export * from './collectors-schema';
export * from './cost-schema';
export * from './community-schema';
