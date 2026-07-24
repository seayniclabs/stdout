/**
 * Observatory Tool Invocation Layer (P7b)
 *
 * The eyes (discovery) and the brain (Watcher/Analyst) are wired, but the brain had no way to
 * actually RUN diagnostic tools — tshark/tcpdump/dig/nmap live inside the `observatory-tools`
 * sidecar, Trivy in its own container, cAdvisor for metrics. This module is the safe bridge:
 * a registry of allowlisted tools the brain may invoke, each with a SAFETY CLASS, executed via
 * `docker exec` with ARGUMENT ARRAYS (never a shell string — the caller is an LLM, so no
 * shell-injection surface), bounded by timeout + output cap, and fully audited.
 *
 * Safety classes (the lab's gated-autofix contract applied to diagnostics):
 *   - 'read-only'  : observes only, no side effects (dig, nmap -sn, tcpdump read, trivy scan,
 *                    cadvisor query). Auto-allowed.
 *   - 'mutating'   : changes state on a target (none shipped yet). Requires gate.
 *   - 'gated'      : potentially heavy / sensitive (full packet capture to disk, deep port scan).
 *                    Allowed only when explicitly requested with `allowGated: true`.
 *
 * The brain calls runTool({ tool, args }). Anything not in the registry is rejected. Args are
 * validated per-tool (allowlisted flags / shape) so the LLM can't smuggle arbitrary commands.
 */

import { execFile } from 'node:child_process';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export type SafetyClass = 'read-only' | 'mutating' | 'gated';

interface ToolDef {
  name: string;
  safety: SafetyClass;
  description: string;
  /** Which container the tool runs in (docker exec target). */
  container: 'observatory-tools' | 'trivy' | 'zeek';
  /** Build the argv (after `docker exec <container>`). Throws if args are invalid. */
  build(args: Record<string, unknown>): string[];
  timeoutMs: number;
}

/** Reject anything that isn't a safe hostname/IP/CIDR token (no shell metachars). */
function safeTarget(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^[A-Za-z0-9._:\/-]{1,128}$/.test(s)) {
    throw new Error(`invalid target: ${JSON.stringify(v)}`);
  }
  return s;
}

/** Reject anything that isn't a bare port-list like "80,443,8112" or "1-1024". */
function safePorts(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^[0-9,\-]{1,64}$/.test(s)) throw new Error(`invalid ports: ${JSON.stringify(v)}`);
  return s;
}

function safeInt(v: unknown, min: number, max: number, dflt: number): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return String(dflt);
  return String(Math.floor(n));
}

/**
 * Tool registry. Each `build` only ever returns a fixed command shape with validated tokens —
 * the LLM picks the tool + supplies a target/ports, never free-form argv.
 */
const TOOLS: Record<string, ToolDef> = {
  dig: {
    name: 'dig',
    safety: 'read-only',
    description: 'DNS lookup for a hostname (resolution / record check).',
    container: 'observatory-tools',
    timeoutMs: 10_000,
    build: (a) => ['dig', '+short', safeTarget(a.target)],
  },
  ping_sweep: {
    name: 'ping_sweep',
    safety: 'read-only',
    description: 'Host-discovery sweep of a subnet (nmap -sn, no port scan).',
    container: 'observatory-tools',
    timeoutMs: 60_000,
    build: (a) => ['nmap', '-sn', '-T4', '--max-retries', '1', safeTarget(a.target)],
  },
  port_scan: {
    name: 'port_scan',
    safety: 'gated', // active connect scan against a host — heavier, gate it
    description: 'TCP connect scan of specific ports on one host (nmap -sT).',
    container: 'observatory-tools',
    timeoutMs: 60_000,
    build: (a) => [
      'nmap', '-sT', '-Pn', '-T4', '--max-retries', '1', '--host-timeout', '45s',
      '-p', safePorts(a.ports ?? '1-1024'), safeTarget(a.target),
    ],
  },
  packet_sample: {
    name: 'packet_sample',
    safety: 'read-only',
    description: 'Capture a bounded sample of packets matching a BPF host filter (tshark, N packets).',
    container: 'observatory-tools',
    timeoutMs: 30_000,
    build: (a) => [
      'tshark', '-i', 'any', '-c', safeInt(a.count, 1, 500, 50),
      '-f', `host ${safeTarget(a.target)}`, '-a', 'duration:20',
    ],
  },
  trivy_image: {
    name: 'trivy_image',
    safety: 'read-only',
    description: 'Scan a container image for CVEs via the Trivy server.',
    container: 'trivy',
    timeoutMs: 120_000,
    build: (a) => ['trivy', 'image', '--quiet', '--severity', 'HIGH,CRITICAL', safeTarget(a.image)],
  },
  zeek_analyze: {
    name: 'zeek_analyze',
    safety: 'read-only',
    description: 'Batch-analyze the captured pcap with Zeek and emit protocol logs (conn/dns/http/ssl/notice).',
    container: 'zeek',
    timeoutMs: 120_000,
    // Reads the read-only pcap, writes Zeek logs to /logs, then prints each protocol log.
    // Fixed command shape — no user-supplied tokens reach the shell.
    build: () => ['sh', '-c', [
      'cd /logs && zeek -r /captures/capture.pcap 2>/dev/null;',
      'for f in conn dns http ssl notice; do',
      '  echo "=== $f.log ===";',
      '  cat /logs/$f.log 2>/dev/null | head-40;',
      'done',
    ].join(' ')],
  },
  // INFRASTRUCTURE MANAGEMENT TOOLS (Riggins can create stacks and monitors)
  discover_network: {
    name: 'discover_network',
    safety: 'read-only',
    description: 'Comprehensive network discovery: ARP scan + mDNS + SSDP. Finds all devices and services.',
    container: 'stdout', // runs in main container
    timeoutMs: 30_000,
    build: () => ['node', '-e', `
      const {scanNetwork} = require('./dist/server/chunks/network-scanner_DExBVjCe.mjs');
      scanNetwork({arpScan:true,mdnsScan:true,ssdpScan:true,vendorLookup:true,timeout:10})
        .then(d => console.log(JSON.stringify(d,null,2)))
        .catch(e => {console.error(e);process.exit(1);});
    `],
  },
  create_stack: {
    name: 'create_stack',
    safety: 'mutating',
    description: 'Create a new infrastructure stack with name and description.',
    container: 'stdout',
    timeoutMs: 5_000,
    build: (a) => ['node', '-e', `
      const {getDb} = require('./dist/server/chunks/db_BGDDlJLW.mjs');
      const {sql} = require('drizzle-orm');
      const {nanoid} = require('nanoid');
      const db = getDb();
      const id = nanoid();
      const now = Date.now();
      db.run(sql\\\`INSERT INTO stacks (id,user_id,name,description,tags,created_at,updated_at)
        VALUES (\${id},\${'${safeTarget(a.userId)}'},\${'${safeTarget(a.name)}'},\${'${safeTarget(a.description)}'},\${'[]'},\${now},\${now})\\\`);
      console.log(JSON.stringify({id,name:'${safeTarget(a.name)}'}));
    `],
  },
  create_monitor: {
    name: 'create_monitor',
    safety: 'mutating',
    description: 'Create a monitor for a service. Requires: name, type (http/tcp/ping), target (URL or IP:port), stackId.',
    container: 'stdout',
    timeoutMs: 5_000,
    build: (a) => ['node', '-e', `
      const {getDb} = require('./dist/server/chunks/db_BGDDlJLW.mjs');
      const {sql} = require('drizzle-orm');
      const {nanoid} = require('nanoid');
      const db = getDb();
      const id = nanoid();
      const now = Date.now();
      db.run(sql\\\`INSERT INTO monitors (id,user_id,stack_id,name,type,target,interval_seconds,paused,current_status,consecutive_failures,created_at,updated_at)
        VALUES (\${id},\${'${safeTarget(a.userId)}'},\${'${safeTarget(a.stackId)}'},\${'${safeTarget(a.name)}'},\${'${safeTarget(a.type)}'},\${'${safeTarget(a.target)}'},\${300},\${0},\${'unknown'},\${0},\${now},\${now})\\\`);
      console.log(JSON.stringify({id,name:'${safeTarget(a.name)}',target:'${safeTarget(a.target)}'}));
    `],
  },
};

export interface ToolResult {
  ok: boolean;
  tool: string;
  safety: SafetyClass;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

const MAX_OUTPUT = 64 * 1024; // cap captured output so a chatty tool can't blow up memory/logs

function execDockerExec(container: string, argv: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const full = ['exec', container, ...argv];
    execFile('docker', full, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT }, (error: any, stdout, stderr) => {
      resolve({
        code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
        stdout: String(stdout || '').slice(0, MAX_OUTPUT),
        stderr: String(stderr || '').slice(0, MAX_OUTPUT),
      });
    });
  });
}

/**
 * Invoke a diagnostic tool on behalf of the brain.
 *
 * @param req.tool      registry key (e.g. 'dig', 'port_scan')
 * @param req.args      tool-specific args (validated per-tool)
 * @param req.allowGated must be true to run a 'gated' tool; ignored for read-only
 * @param req.userId    for audit attribution
 * @param req.reason    why the brain wants to run this (audited)
 */
export async function runTool(req: {
  tool: string;
  args?: Record<string, unknown>;
  allowGated?: boolean;
  userId?: string;
  reason?: string;
}): Promise<ToolResult> {
  const start = Date.now();
  const def = TOOLS[req.tool];

  if (!def) {
    return failure(req.tool, 'read-only', start, `unknown tool "${req.tool}" — not in the allowlist`);
  }

  // Gate enforcement: mutating + gated tools require explicit opt-in.
  if ((def.safety === 'gated' || def.safety === 'mutating') && !req.allowGated) {
    await auditTool(req.userId, def, [], 'blocked', req.reason, 'gate not granted');
    return failure(def.name, def.safety, start, `tool "${def.name}" is ${def.safety} — requires allowGated=true`);
  }

  let argv: string[];
  try {
    argv = def.build(req.args ?? {});
  } catch (error: unknown) {
    await auditTool(req.userId, def, [], 'rejected', req.reason, error instanceof Error ? error.message : String(error));
    return failure(def.name, def.safety, start, `arg validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const { code, stdout, stderr } = await execDockerExec(def.container, argv, def.timeoutMs);
  const ok = code === 0;
  await auditTool(req.userId, def, argv, ok ? 'success' : 'error', req.reason, ok ? undefined : stderr.slice(0, 200));

  return {
    ok,
    tool: def.name,
    safety: def.safety,
    stdout,
    stderr,
    exitCode: code,
    durationMs: Date.now() - start,
    error: ok ? undefined : `exit ${code}`,
  };
}

/** Machine-readable manifest of available tools — handed to the brain so it knows its options. */
export function listTools(): Array<{ name: string; safety: SafetyClass; description: string }> {
  return Object.values(TOOLS).map((t) => ({ name: t.name, safety: t.safety, description: t.description }));
}

function failure(tool: string, safety: SafetyClass, start: number, error: string): ToolResult {
  return { ok: false, tool, safety, stdout: '', stderr: '', exitCode: null, durationMs: Date.now() - start, error };
}

/** Audit every tool invocation (and every block/rejection) into observatory_agent_runs. */
async function auditTool(
  userId: string | undefined,
  def: ToolDef,
  argv: string[],
  outcome: 'success' | 'error' | 'blocked' | 'rejected',
  reason: string | undefined,
  detail: string | undefined,
): Promise<void> {
  try {
    const db = getDb();
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    db.run(sql`
      INSERT INTO observatory_agent_runs
        (id, user_id, agent_name, stack_id, trigger, input_context, output_decision, decision_made, confidence_score, execution_time_ms, created_at)
      VALUES (
        ${id}, ${userId ?? 'system'}, 'toolbox', ${null}, 'tool_invocation',
        ${JSON.stringify({ tool: def.name, safety: def.safety, argv, reason: reason ?? null })},
        ${JSON.stringify({ outcome, detail: detail ?? null })},
        ${`${def.name}:${outcome}`}, ${null}, ${null}, ${Date.now()}
      )
    `);
  } catch {
    // Auditing must never break a diagnostic call.
  }
}
