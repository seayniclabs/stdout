#!/usr/bin/env node
/**
 * Functional test for Suricata TOOL1 correlation (no Windlass side effects).
 *
 * Usage:
 *   cat fixtures/sample_eve.json | node scripts/suricata-functional-test.mjs
 *   node scripts/suricata-functional-test.mjs fixtures/sample_eve.json
 *
 * Success: prints a line containing "Windlass action triggered".
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySuricataEve,
  parseEveLine,
  resetCorrelationState,
  safeActionLabel,
} from '../src/lib/suricata-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  resetCorrelationState();

  let text = '';
  if (process.argv[2]) {
    text = readFileSync(resolve(process.cwd(), process.argv[2]), 'utf8');
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  } else {
    text = readFileSync(resolve(__dirname, '../fixtures/sample_eve.json'), 'utf8');
  }

  const events = [];
  for (const line of text.split('\n')) {
    const obj = parseEveLine(line);
    if (obj) events.push(obj);
  }
  if (events.length === 0) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) events.push(obj);
    } catch {
      // fall through
    }
  }

  if (events.length === 0) {
    console.error('No EVE JSON events found');
    process.exit(1);
  }

  for (const ev of events) {
    const alert = classifySuricataEve(ev);
    if (alert.kind === 'none') {
      console.log(`skipped event_type=${ev.event_type || 'unknown'}`);
      continue;
    }
    // Dry-run: classify only. Live path posts to Windlass /anomaly.json (or /v1/*).
    const wouldAct = alert.kind === 'ip_block' || alert.kind === 'service';
    if (wouldAct) {
      console.log('Windlass action triggered');
      console.log(safeActionLabel(alert, alert.kind, true));
    } else {
      console.log(`no action kind=${alert.kind} sev=${alert.severity}`);
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
