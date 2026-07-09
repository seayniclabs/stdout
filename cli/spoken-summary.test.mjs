import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipToSpoken, formatSpokenSummary } from './lib/spoken-summary.mjs';

test('clipToSpoken adds trailing period and respects word budget', () => {
  assert.equal(clipToSpoken('memory leak in api'), 'memory leak in api.');
  const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const clipped = clipToSpoken(long, 10);
  assert.equal(clipped.split(' ').length, 10);
  assert.ok(clipped.endsWith('.'));
});

test('formatSpokenSummary prefers top root cause and command', () => {
  const summary = formatSpokenSummary({
    rootCauses: ['Container memory limit too low on prod-api'],
    suggestedCommands: ['docker stats prod-api'],
  });
  assert.match(summary, /memory limit/i);
  assert.match(summary, /docker stats/i);
  assert.ok(summary.split(/\s+/).length <= 45);
});

test('formatSpokenSummary falls back to health and open incidents', () => {
  const summary = formatSpokenSummary({
    health: {
      services_total: 4,
      services_healthy: 2,
      services_degraded: 0,
      services_down: 2,
    },
    incidents: [
      { title: 'High memory on prod', resolved: false },
      { title: 'Old issue', resolved: true },
    ],
  });
  assert.match(summary, /2 services down/i);
  assert.match(summary, /High memory on prod/i);
});

test('formatSpokenSummary empty input returns fallback', () => {
  assert.match(formatSpokenSummary({}), /couldn't diagnose/i);
});
