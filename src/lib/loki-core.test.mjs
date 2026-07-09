import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLogQL,
  classifyLogLine,
  parseLokiResponse,
  aggregateLokiMetrics,
  groupErrorsByService,
  payloadFromBody,
  hasLogData,
  clampRangeMinutes,
  isUnboundedStart,
  DEFAULT_ERROR_LOGQL,
  DEFAULT_JOB,
  DEFAULT_RANGE_MINUTES,
  MAX_RANGE_MINUTES,
} from './loki-core.mjs';

test('buildLogQL — explicit query wins', () => {
  assert.equal(buildLogQL({ query: '{app="x"} |= "boom"' }), '{app="x"} |= "boom"');
});

test('buildLogQL — service/job labels', () => {
  assert.equal(
    buildLogQL({ service: 'api', job: 'varlogs' }),
    '{service="api",job="varlogs"} |~ "(?i)(error|critical|fatal|panic|exception|fail)"',
  );
});

test('buildLogQL — default error selector uses job=stdout', () => {
  assert.equal(buildLogQL({}), DEFAULT_ERROR_LOGQL);
  assert.match(DEFAULT_ERROR_LOGQL, new RegExp(`job="${DEFAULT_JOB}"`));
  assert.equal(
    buildLogQL({}),
    '{job="stdout"} |~ "(?i)(error|critical|fatal|panic|exception|fail)"',
  );
});

test('buildLogQL — optional executor label', () => {
  assert.equal(
    buildLogQL({ job: 'stdout', executor: true }),
    '{job="stdout",__tmp_durable_executor="loki"} |~ "(?i)(error|critical|fatal|panic|exception|fail)"',
  );
});

test('buildLogQL — escapes quotes in labels', () => {
  assert.equal(
    buildLogQL({ service: 'a"b' }),
    '{service="a\\"b"} |~ "(?i)(error|critical|fatal|panic|exception|fail)"',
  );
});

test('clampRangeMinutes — bounds and defaults', () => {
  assert.equal(clampRangeMinutes(undefined), DEFAULT_RANGE_MINUTES);
  assert.equal(clampRangeMinutes(0), DEFAULT_RANGE_MINUTES);
  assert.equal(clampRangeMinutes(-1), DEFAULT_RANGE_MINUTES);
  assert.equal(clampRangeMinutes(5), 5);
  assert.equal(clampRangeMinutes(99999), MAX_RANGE_MINUTES);
});

test('isUnboundedStart — rejects start=0 markers', () => {
  assert.equal(isUnboundedStart(0), true);
  assert.equal(isUnboundedStart('0'), true);
  assert.equal(isUnboundedStart('000'), true);
  assert.equal(isUnboundedStart(undefined), false);
  assert.equal(isUnboundedStart(1_710_000_000_000), false);
});

test('classifyLogLine — severity tiers', () => {
  assert.equal(classifyLogLine('FATAL: disk full'), 'critical');
  assert.equal(classifyLogLine('ERROR connection refused'), 'error');
  assert.equal(classifyLogLine('WARN retrying'), 'warn');
  assert.equal(classifyLogLine('info: started'), 'info');
});

test('parseLokiResponse — full API envelope', () => {
  const ns = String(1_710_000_000_000_000_000n);
  const entries = parseLokiResponse({
    status: 'success',
    data: {
      resultType: 'streams',
      result: [
        {
          stream: { job: 'api', service: 'gateway' },
          values: [
            [ns, 'ERROR connection refused'],
            [String(1_710_000_001_000_000_000n), 'FATAL panic in handler'],
          ],
        },
      ],
    },
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].labels.job, 'api');
  assert.equal(entries[0].severity, 'error');
  assert.equal(entries[1].severity, 'critical');
  assert.ok(entries[0].timestamp > 0);
});

test('parseLokiResponse — pre-normalized logs', () => {
  const entries = parseLokiResponse({
    logs: [
      { message: 'error: boom', labels: { job: 'x' } },
      'WARN slow query',
    ],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].severity, 'error');
  assert.equal(entries[1].severity, 'warn');
});

test('aggregateLokiMetrics — counts by severity', () => {
  const entries = parseLokiResponse({
    logs: [
      { message: 'ERROR a', labels: { job: 'a' } },
      { message: 'ERROR b', labels: { job: 'a' } },
      { message: 'FATAL c', labels: { job: 'b' } },
      { message: 'WARN d', labels: { job: 'b' } },
      { message: 'ok', labels: { job: 'c' } },
    ],
  });
  const m = aggregateLokiMetrics(entries);
  assert.equal(m.loki_log_total, 5);
  assert.equal(m.loki_error_count, 3); // 2 error + 1 critical
  assert.equal(m.loki_critical_count, 1);
  assert.equal(m.loki_warn_count, 1);
  assert.equal(m.loki_stream_count, 3);
});

test('groupErrorsByService — ranks by count', () => {
  const entries = parseLokiResponse({
    logs: [
      { message: 'ERROR 1', labels: { service: 'api' } },
      { message: 'ERROR 2', labels: { service: 'api' } },
      { message: 'FATAL 3', labels: { service: 'api' } },
      { message: 'ERROR 4', labels: { service: 'db' } },
    ],
  });
  const groups = groupErrorsByService(entries);
  assert.equal(groups[0].service, 'api');
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].critical, 1);
  assert.equal(groups[1].service, 'db');
});

test('payloadFromBody — extracts query opts and entries', () => {
  const { queryOpts, entries } = payloadFromBody({
    query: '{job="stdout"}',
    minutes: 30,
    logs: [{ message: 'error: x', labels: { job: 'stdout' } }],
  });
  assert.equal(queryOpts.query, '{job="stdout"}');
  assert.equal(queryOpts.minutes, 30);
  assert.equal(entries.length, 1);
  assert.ok(hasLogData(entries));
});

test('payloadFromBody — executor label passthrough', () => {
  const { queryOpts } = payloadFromBody({ job: 'stdout', executor: true });
  assert.equal(queryOpts.job, 'stdout');
  assert.equal(queryOpts.executor, true);
});

test('payloadFromBody — empty body has no entries', () => {
  const { entries } = payloadFromBody({});
  assert.equal(hasLogData(entries), false);
});
