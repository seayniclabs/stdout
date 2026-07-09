/**
 * Suricata background ingestors — file-tail eve.json, Redis list (BLPOP), Redis stream (XREADGROUP).
 *
 * Enabled via env (set in docker-compose.observatory.yml when Suricata is on):
 *   SURICATA_EVE_PATH=/var/log/suricata/eve.json
 *   SURICATA_REDIS_URL=redis://127.0.0.1:6379/0
 *   SURICATA_REDIS_MODE=list|stream   (default: list; use stream for XREADGROUP)
 *   SURICATA_REDIS_KEY=suricata       (list key for BLPOP)
 *   SURICATA_REDIS_STREAM=eve_alerts  (stream key for XREADGROUP)
 *   SURICATA_REDIS_GROUP=stream       (consumer group name)
 *   SURICATA_REDIS_CONSUMER=stdout-1
 *   SURICATA_REDIS_BLOCK_MS=2000      (short block — loop continuously; avoids hung agents)
 *   SURICATA_USER_ID=<owner user id>  (falls back to first admin)
 *   SURICATA_AUTO_FIX=true|false
 *
 * Webhook push (always available): POST /app/api/suricata/webhook
 *
 * Prior lesson: long XREADGROUP blocks (600–1200s) hang agent sessions. Use a short
 * block timeout and loop; Redis retains stream entries until XACK.
 */

import { createConnection, type Socket } from 'node:net';
import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { getDb, schema } from './db';
import { ingestSuricataEve, parseEveLine } from './suricata';
import { eveFromStreamFields } from './suricata-core.mjs';

export interface SuricataIngestStatus {
  fileTail: {
    enabled: boolean;
    path: string | null;
    offset: number;
    lastError: string | null;
    linesRead: number;
  };
  redis: {
    enabled: boolean;
    mode: 'list' | 'stream';
    url: string | null;
    key: string;
    group: string | null;
    consumer: string | null;
    lastError: string | null;
    messagesRead: number;
  };
  ownerUserId: string | null;
  running: boolean;
}

const status: SuricataIngestStatus = {
  fileTail: {
    enabled: false,
    path: null,
    offset: 0,
    lastError: null,
    linesRead: 0,
  },
  redis: {
    enabled: false,
    mode: 'list',
    url: null,
    key: 'suricata',
    group: null,
    consumer: null,
    lastError: null,
    messagesRead: 0,
  },
  ownerUserId: null,
  running: false,
};

let started = false;
let fileHandle: FileHandle | null = null;
let fileBuffer = '';
let stopRequested = false;
let streamGroupReady = false;

function autoFixEnabled(): boolean {
  const v = (process.env.SURICATA_AUTO_FIX || 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function resolveOwnerUserId(): string | null {
  const explicit = (process.env.SURICATA_USER_ID || '').trim();
  if (explicit) return explicit;

  try {
    const db = getDb();
    const admin = db.select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .all()
      .find(u => u.role === 'admin');
    if (admin) return admin.id;
    const any = db.select({ id: schema.users.id }).from(schema.users).get();
    return any?.id ?? null;
  } catch {
    return null;
  }
}

async function handleEveObject(userId: string, obj: Record<string, unknown>): Promise<void> {
  try {
    await ingestSuricataEve(userId, obj, { autoFix: autoFixEnabled() });
  } catch (err: any) {
    // Do not log alert payloads or IPs (security review).
    console.error('[suricata-ingest] ingest failed:', err?.message || 'unknown');
  }
}

// ── File tail ──────────────────────────────────────────────────────────────

async function tickFileTail(userId: string): Promise<void> {
  const path = status.fileTail.path;
  if (!path) return;

  try {
    const st = await stat(path);
    // Rotation: file shrank — reopen from start.
    if (st.size < status.fileTail.offset) {
      status.fileTail.offset = 0;
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
        fileHandle = null;
      }
    }

    if (!fileHandle) {
      fileHandle = await open(path, 'r');
    }

    if (st.size === status.fileTail.offset) return;

    const length = st.size - status.fileTail.offset;
    const buf = Buffer.alloc(Math.min(length, 256 * 1024));
    const { bytesRead } = await fileHandle.read(buf, 0, buf.length, status.fileTail.offset);
    if (bytesRead <= 0) return;

    status.fileTail.offset += bytesRead;
    fileBuffer += buf.subarray(0, bytesRead).toString('utf8');

    let nl: number;
    while ((nl = fileBuffer.indexOf('\n')) >= 0) {
      const line = fileBuffer.slice(0, nl);
      fileBuffer = fileBuffer.slice(nl + 1);
      const obj = parseEveLine(line);
      if (!obj) continue;
      status.fileTail.linesRead += 1;
      await handleEveObject(userId, obj);
    }

    // Suricata writes NDJSON with trailing newlines; test fixtures often omit the
    // final newline — flush a complete trailing object when we've reached EOF.
    if (fileBuffer.trim() && status.fileTail.offset >= st.size) {
      const obj = parseEveLine(fileBuffer);
      if (obj) {
        status.fileTail.linesRead += 1;
        await handleEveObject(userId, obj);
      }
      fileBuffer = '';
    }

    status.fileTail.lastError = null;
  } catch (err: any) {
    status.fileTail.lastError = err?.message || String(err);
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
      fileHandle = null;
    }
  }
}

// ── Minimal Redis RESP client — no extra dependency ────────────────────────

function parseRedisUrl(url: string): { host: string; port: number; db: number; password: string | null } {
  const u = new URL(url);
  const dbPath = u.pathname.replace(/^\//, '');
  const db = dbPath ? Number(dbPath) || 0 : 0;
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port ? Number(u.port) : 6379,
    db,
    password: u.password ? decodeURIComponent(u.password) : null,
  };
}

function encodeResp(...args: (string | number)[]): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const a of args) {
    const s = String(a);
    parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  }
  return Buffer.from(parts.join(''));
}

/** Parse one complete RESP value from buf; returns [value, bytesConsumed] or null if incomplete. */
function parseResp(buf: Buffer, offset = 0): [unknown, number] | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]);

  const readLine = (start: number): [string, number] | null => {
    for (let i = start; i + 1 < buf.length; i++) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
        return [buf.subarray(start, i).toString('utf8'), i + 2];
      }
    }
    return null;
  };

  if (type === '+' || type === '-' || type === ':') {
    const line = readLine(offset + 1);
    if (!line) return null;
    const [text, next] = line;
    if (type === '-') throw new Error(text);
    if (type === ':') return [Number(text), next];
    return [text, next];
  }

  if (type === '$') {
    const line = readLine(offset + 1);
    if (!line) return null;
    const [lenStr, dataStart] = line;
    const len = Number(lenStr);
    if (len < 0) return [null, dataStart];
    if (dataStart + len + 2 > buf.length) return null;
    const val = buf.subarray(dataStart, dataStart + len).toString('utf8');
    return [val, dataStart + len + 2];
  }

  if (type === '*') {
    const line = readLine(offset + 1);
    if (!line) return null;
    const [countStr, itemStart] = line;
    const count = Number(countStr);
    if (count < 0) return [null, itemStart];
    const items: unknown[] = [];
    let pos = itemStart;
    for (let i = 0; i < count; i++) {
      const item = parseResp(buf, pos);
      if (!item) return null;
      items.push(item[0]);
      pos = item[1];
    }
    return [items, pos];
  }

  throw new Error(`Unknown RESP type: ${type}`);
}

async function redisCommand(
  url: string,
  argsList: (string | number)[][],
  waitMs: number,
): Promise<unknown[]> {
  const cfg = parseRedisUrl(url);
  const commands: (string | number)[][] = [];
  if (cfg.password) commands.push(['AUTH', cfg.password]);
  if (cfg.db) commands.push(['SELECT', cfg.db]);
  commands.push(...argsList);

  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: cfg.host, port: cfg.port });
    let buf = Buffer.alloc(0);
    const replies: unknown[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        // Blocking commands (BLPOP / XREADGROUP) time out with null — treat as empty success.
        while (replies.length < commands.length) replies.push(null);
        resolve(replies);
      }
    }, waitMs);

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(replies);
    };

    socket.on('connect', () => {
      for (const args of commands) {
        socket.write(encodeResp(...args));
      }
    });

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        while (replies.length < commands.length) {
          const parsed = parseResp(buf, 0);
          if (!parsed) break;
          replies.push(parsed[0]);
          buf = Buffer.from(buf.subarray(parsed[1]));
        }
        if (replies.length >= commands.length) finish(null);
      } catch (err: any) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.on('error', (err) => finish(err));
    socket.on('close', () => {
      if (!settled) {
        if (replies.length >= commands.length) finish(null);
        else finish(new Error('Redis connection closed early'));
      }
    });
  });
}

async function redisBlpop(url: string, key: string, timeoutSec: number): Promise<string | null> {
  const replies = await redisCommand(
    url,
    [['BLPOP', key, timeoutSec]],
    (timeoutSec + 3) * 1000,
  );
  const val = replies[replies.length - 1];
  if (Array.isArray(val) && val.length >= 2) return String(val[1]);
  return null;
}

async function ensureStreamGroup(url: string, stream: string, group: string): Promise<void> {
  if (streamGroupReady) return;
  try {
    await redisCommand(url, [['XGROUP', 'CREATE', stream, group, '0', 'MKSTREAM']], 5000);
    streamGroupReady = true;
  } catch (err: any) {
    const msg = err?.message || String(err);
    // BUSYGROUP = already exists — fine.
    if (/BUSYGROUP/i.test(msg)) {
      streamGroupReady = true;
      return;
    }
    throw err;
  }
}

/**
 * XREADGROUP with a short BLOCK — loop continuously so agent sessions never hang
 * on a multi-minute blocking read (prior lesson: 600–1200s timeouts).
 */
async function redisXreadgroup(
  url: string,
  stream: string,
  group: string,
  consumer: string,
  blockMs: number,
): Promise<Array<{ id: string; fields: string[] }>> {
  const replies = await redisCommand(
    url,
    [[
      'XREADGROUP', 'GROUP', group, consumer,
      'COUNT', 32,
      'BLOCK', blockMs,
      'STREAMS', stream, '>',
    ]],
    blockMs + 3000,
  );
  const val = replies[replies.length - 1];
  if (!val || !Array.isArray(val)) return [];

  const out: Array<{ id: string; fields: string[] }> = [];
  for (const streamEntry of val as unknown[]) {
    if (!Array.isArray(streamEntry) || streamEntry.length < 2) continue;
    const messages = streamEntry[1];
    if (!Array.isArray(messages)) continue;
    for (const msg of messages) {
      if (!Array.isArray(msg) || msg.length < 2) continue;
      const id = String(msg[0]);
      const fields = Array.isArray(msg[1]) ? (msg[1] as unknown[]).map(String) : [];
      out.push({ id, fields });
    }
  }
  return out;
}

async function redisXack(url: string, stream: string, group: string, id: string): Promise<void> {
  await redisCommand(url, [['XACK', stream, group, id]], 5000);
}

async function tickRedisList(userId: string): Promise<void> {
  const url = status.redis.url;
  if (!url) return;

  try {
    const payload = await redisBlpop(url, status.redis.key, 2);
    status.redis.lastError = null;
    if (!payload) return;

    status.redis.messagesRead += 1;
    const obj = parseEveLine(payload);
    if (obj) await handleEveObject(userId, obj);
  } catch (err: any) {
    status.redis.lastError = err?.message || String(err);
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function tickRedisStream(userId: string): Promise<void> {
  const url = status.redis.url;
  const stream = status.redis.key;
  const group = status.redis.group;
  const consumer = status.redis.consumer;
  if (!url || !group || !consumer) return;

  const blockMs = Math.max(500, Number(process.env.SURICATA_REDIS_BLOCK_MS) || 2000);

  try {
    await ensureStreamGroup(url, stream, group);
    const messages = await redisXreadgroup(url, stream, group, consumer, blockMs);
    status.redis.lastError = null;

    for (const msg of messages) {
      const obj = eveFromStreamFields(msg.fields);
      if (obj) {
        status.redis.messagesRead += 1;
        await handleEveObject(userId, obj);
      }
      try {
        await redisXack(url, stream, group, msg.id);
      } catch {
        // Best-effort ACK; message may be redelivered.
      }
    }
  } catch (err: any) {
    status.redis.lastError = err?.message || String(err);
    streamGroupReady = false;
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ── Public control ─────────────────────────────────────────────────────────

export function getSuricataIngestStatus(): SuricataIngestStatus {
  return {
    ...status,
    fileTail: { ...status.fileTail },
    redis: { ...status.redis },
  };
}

/**
 * Start background file-tail and/or Redis consumers. Idempotent.
 */
export function startSuricataIngestors(): void {
  if (started) return;
  started = true;
  stopRequested = false;
  streamGroupReady = false;

  const evePath = (process.env.SURICATA_EVE_PATH || '').trim();
  const redisUrl = (process.env.SURICATA_REDIS_URL || '').trim();
  const modeRaw = (process.env.SURICATA_REDIS_MODE || 'list').trim().toLowerCase();
  const mode: 'list' | 'stream' = modeRaw === 'stream' ? 'stream' : 'list';

  const listKey = (process.env.SURICATA_REDIS_KEY || 'suricata').trim() || 'suricata';
  const streamKey = (process.env.SURICATA_REDIS_STREAM || 'eve_alerts').trim() || 'eve_alerts';
  const group = (process.env.SURICATA_REDIS_GROUP || 'stream').trim() || 'stream';
  const consumer = (process.env.SURICATA_REDIS_CONSUMER || 'stdout-1').trim() || 'stdout-1';

  status.fileTail.enabled = Boolean(evePath);
  status.fileTail.path = evePath || null;
  status.redis.enabled = Boolean(redisUrl);
  status.redis.url = redisUrl || null;
  status.redis.mode = mode;
  status.redis.key = mode === 'stream' ? streamKey : listKey;
  status.redis.group = mode === 'stream' ? group : null;
  status.redis.consumer = mode === 'stream' ? consumer : null;

  if (!status.fileTail.enabled && !status.redis.enabled) {
    console.log('[suricata-ingest] No SURICATA_EVE_PATH or SURICATA_REDIS_URL — background ingest idle (webhook still available)');
    status.running = false;
    return;
  }

  status.running = true;
  console.log(
    '[suricata-ingest] Starting —',
    status.fileTail.enabled ? `file=${evePath}` : 'file=off',
    status.redis.enabled
      ? `redis=${mode} key=${status.redis.key}${mode === 'stream' ? ` group=${group}` : ''}`
      : 'redis=off',
  );

  if (status.fileTail.enabled) {
    (async () => {
      while (!stopRequested) {
        const userId = status.ownerUserId || resolveOwnerUserId();
        status.ownerUserId = userId;
        if (userId) await tickFileTail(userId);
        await new Promise(r => setTimeout(r, 1000));
      }
    })().catch(err => console.error('[suricata-ingest] file-tail loop crashed:', err?.message || err));
  }

  if (status.redis.enabled) {
    (async () => {
      while (!stopRequested) {
        const userId = status.ownerUserId || resolveOwnerUserId();
        status.ownerUserId = userId;
        if (userId) {
          if (mode === 'stream') await tickRedisStream(userId);
          else await tickRedisList(userId);
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    })().catch(err => console.error('[suricata-ingest] redis loop crashed:', err?.message || err));
  }
}

export function stopSuricataIngestors(): void {
  stopRequested = true;
  status.running = false;
  if (fileHandle) {
    fileHandle.close().catch(() => {});
    fileHandle = null;
  }
}
