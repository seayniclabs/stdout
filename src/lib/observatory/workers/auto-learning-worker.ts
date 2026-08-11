/**
 * Auto-Learning Worker
 *
 * Phase 3.1: Open-Notebook Local RAG
 *
 * Periodically scans for resolved incidents and generates post-mortems.
 * Runs every 5 minutes in the background.
 */

import { backfillPostMortems } from '../../open-notebook/auto-learning';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Run auto-learning cycle
 */
async function runCycle() {
  if (isRunning) {
    console.log('[Auto-Learning Worker] Cycle already running, skipping');
    return;
  }

  try {
    isRunning = true;
    console.log('[Auto-Learning Worker] Starting backfill cycle');

    const generated = await backfillPostMortems();

    if (generated > 0) {
      console.log(`[Auto-Learning Worker] Generated ${generated} post-mortems`);
    } else {
      console.log('[Auto-Learning Worker] No new post-mortems generated');
    }
  } catch (error) {
    console.error('[Auto-Learning Worker] Cycle error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the auto-learning worker
 */
export function startAutoLearningWorker() {
  if (intervalId) {
    console.warn('[Auto-Learning Worker] Already running');
    return;
  }

  console.log('[Auto-Learning Worker] Starting (interval: 5min)');

  // Run immediately on start
  runCycle();

  // Schedule periodic runs
  intervalId = setInterval(() => {
    runCycle();
  }, INTERVAL_MS);
}

/**
 * Stop the auto-learning worker
 */
export function stopAutoLearningWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Auto-Learning Worker] Stopped');
  }
}
