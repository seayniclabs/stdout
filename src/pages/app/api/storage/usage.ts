/**
 * GET /app/api/storage/usage
 * Get current storage usage breakdown
 */

import type { APIRoute } from 'astro';
import { getStorageUsage, formatBytes } from '../../../../lib/storage/storage-monitor';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const usage = await getStorageUsage();

    return new Response(JSON.stringify({
      ...usage,
      formatted: {
        total: formatBytes(usage.total_bytes),
        used: formatBytes(usage.used_bytes),
        free: formatBytes(usage.free_bytes),
        database: formatBytes(usage.breakdown.database),
        logs: formatBytes(usage.breakdown.logs),
        metrics: formatBytes(usage.breakdown.metrics),
        docs: formatBytes(usage.breakdown.docs),
        other: formatBytes(usage.breakdown.other),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Storage usage check failed:', error);

    return new Response(JSON.stringify({
      error: 'Storage check failed',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
