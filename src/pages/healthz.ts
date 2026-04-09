import type { APIRoute } from 'astro';
import { getCentralDb } from '../lib/db';
import { sql } from 'drizzle-orm';

// In-memory cache for the healthz response (10s TTL).
// Avoids hammering SQLite under probe load. Production-watch pings every 5 min,
// but multiple monitoring sources may converge on this endpoint over time.
let cachedAt = 0;
let cachedResponse: { body: object; status: number } | null = null;
const CACHE_TTL_MS = 10_000;

const VERSION = '1.0.0';
const startTime = Date.now();

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime_seconds: number;
  timestamp: string;
  dependencies: {
    database: 'ok' | 'down';
    windlass_sidecar?: 'ok' | 'degraded' | 'down';
  };
}

async function checkDatabase(): Promise<'ok' | 'down'> {
  try {
    const db = getCentralDb();
    db.run(sql`SELECT 1`);
    return 'ok';
  } catch (e) {
    return 'down';
  }
}

async function checkWindlassSidecar(): Promise<'ok' | 'degraded'> {
  // Best-effort: 1-second timeout, never fails the overall healthz.
  // Windlass is a sidecar and can be down without StdOut being down.
  try {
    const url = process.env.WINDLASS_URL || 'http://windlass:8118/healthz';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return resp.ok ? 'ok' : 'degraded';
  } catch {
    return 'degraded';
  }
}

export const GET: APIRoute = async () => {
  const now = Date.now();

  // Serve from cache if fresh
  if (cachedResponse && now - cachedAt < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cachedResponse.body), {
      status: cachedResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Healthz-Cache': 'HIT',
      },
    });
  }

  // Run checks in parallel
  const [databaseStatus, windlassStatus] = await Promise.all([
    checkDatabase(),
    checkWindlassSidecar(),
  ]);

  // Determine overall status
  let overallStatus: 'ok' | 'degraded' | 'down' = 'ok';
  if (databaseStatus === 'down') {
    overallStatus = 'down';
  } else if (windlassStatus === 'degraded') {
    overallStatus = 'degraded';
  }

  const body: HealthResponse = {
    status: overallStatus,
    version: VERSION,
    uptime_seconds: Math.floor((now - startTime) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: {
      database: databaseStatus,
      windlass_sidecar: windlassStatus,
    },
  };

  // 503 if database is down — production-watch and any other monitor will alert
  const status = overallStatus === 'down' ? 503 : 200;

  // Cache the response
  cachedResponse = { body, status };
  cachedAt = now;

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Healthz-Cache': 'MISS',
    },
  });
};
