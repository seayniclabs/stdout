import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySuricataEve,
  eveFromStreamFields,
  getSuricataMetrics,
  incMetric,
  mapSuricataSeverity,
  metricsPrometheusText,
  parseEveLine,
  recordCorrelation,
  resetCorrelationState,
  resetSuricataMetrics,
  safeActionLabel,
} from './suricata-core.mjs';

const sampleAlert = (overrides = {}) => ({
  timestamp: '2026-07-03T12:00:00.000000+0000',
  event_type: 'alert',
  src_ip: '203.0.113.50',
  src_port: 54321,
  dest_ip: '192.168.1.10',
  dest_port: 22,
  proto: 'TCP',
  alert: {
    action: 'allowed',
    gid: 1,
    signature_id: 2001219,
    rev: 1,
    signature: 'ET SCAN Potential SSH Scan',
    category: 'Attempted Information Leak',
    severity: 1,
  },
  ...overrides,
});

test('mapSuricataSeverity — inverted scale', () => {
  assert.equal(mapSuricataSeverity(1), 'critical');
  assert.equal(mapSuricataSeverity(2), 'warning');
  assert.equal(mapSuricataSeverity(3), 'info');
  assert.equal(mapSuricataSeverity(null), 'info');
});

test('parseEveLine — valid / invalid', () => {
  assert.deepEqual(parseEveLine('{"event_type":"alert"}'), { event_type: 'alert' });
  assert.equal(parseEveLine(''), null);
  assert.equal(parseEveLine('not-json'), null);
  assert.equal(parseEveLine('[1,2]'), null);
});

test('classifySuricataEve — high severity → ip_block', () => {
  resetCorrelationState();
  const alert = classifySuricataEve(sampleAlert());
  assert.equal(alert.kind, 'ip_block');
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.srcIp, '203.0.113.50');
  assert.ok(alert.signature.includes('SSH Scan'));
});

test('classifySuricataEve — skips non-alert events', () => {
  const alert = classifySuricataEve({
    event_type: 'flow',
    src_ip: '203.0.113.50',
    dest_ip: '192.168.1.10',
  });
  assert.equal(alert.kind, 'none');
  assert.equal(alert.alertCount, 0);
});

test('recordCorrelation — threshold triggers correlated ip_block', () => {
  resetCorrelationState();
  const medium = (n) => sampleAlert({
    alert: {
      action: 'allowed',
      gid: 1,
      signature_id: n,
      signature: `ET POLICY Example ${n}`,
      category: 'Misc',
      severity: 2,
    },
  });

  const a1 = classifySuricataEve(medium(1));
  assert.equal(a1.correlated, false);
  assert.equal(a1.kind, 'service'); // warning + serviceHint, not yet correlated

  classifySuricataEve(medium(2));
  const a3 = classifySuricataEve(medium(3));
  assert.equal(a3.correlated, true);
  assert.equal(a3.kind, 'ip_block');
  assert.ok(a3.alertCount >= 3);
});

test('eveFromStreamFields — event field JSON', () => {
  const eve = sampleAlert();
  const fields = ['event', JSON.stringify(eve)];
  const obj = eveFromStreamFields(fields);
  assert.equal(obj.event_type, 'alert');
  assert.equal(obj.src_ip, '203.0.113.50');
});

test('eveFromStreamFields — flat alert.* fields', () => {
  const obj = eveFromStreamFields([
    'event_type', 'alert',
    'src_ip', '198.51.100.9',
    'alert.signature', 'ET TEST',
    'alert.severity', '1',
    'alert.signature_id', '99',
  ]);
  assert.equal(obj.event_type, 'alert');
  assert.equal(obj.src_ip, '198.51.100.9');
  assert.equal(obj.alert.signature, 'ET TEST');
  assert.equal(obj.alert.severity, 1);
});

test('safeActionLabel — no IP addresses', () => {
  resetCorrelationState();
  const alert = classifySuricataEve(sampleAlert());
  const label = safeActionLabel(alert, 'ip_block', true);
  assert.match(label, /Windlass action executed/);
  assert.match(label, /action=ip_block/);
  assert.doesNotMatch(label, /203\.0\.113\.50/);
  assert.doesNotMatch(label, /\b\d{1,3}(\.\d{1,3}){3}\b/);
});

test('metrics — counters and prometheus text', () => {
  resetSuricataMetrics();
  incMetric('suricata_alerts_processed', 2);
  incMetric('suricata_windlass_actions');
  const m = getSuricataMetrics();
  assert.equal(m.suricata_alerts_processed, 2);
  assert.equal(m.suricata_windlass_actions, 1);
  const text = metricsPrometheusText();
  assert.match(text, /suricata_alerts_processed 2/);
  assert.match(text, /suricata_windlass_actions 1/);
});

test('recordCorrelation — prunes after window', () => {
  resetCorrelationState();
  const now = Date.now();
  recordCorrelation('203.0.113.1', 'sig-a', 2, now);
  // Far future — bucket expired, count resets.
  const snap = recordCorrelation('203.0.113.1', 'sig-b', 2, now + 400_000);
  assert.equal(snap.count, 1);
  assert.equal(snap.correlated, false);
});
