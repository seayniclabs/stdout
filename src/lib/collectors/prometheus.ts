/**
 * PrometheusCollector — scrapes /metrics (Prometheus text exposition format)
 * This is distinct from src/lib/prometheus.ts which queries the Prometheus query API.
 * This collector hits any endpoint exposing the text format (node_exporter, cadvisor, etc.)
 */
import http from 'node:http';
import https from 'node:https';
import { type CanonicalEvent, normalizeEvent } from './normalize';

export interface PrometheusCollectorConfig {
  url: string;
  entityLabel?: string;     // label to use as entity (default: tries 'instance', then 'job', then hostname)
  timeoutMs?: number;
  authHeader?: string;      // e.g. "Bearer <token>" or "Basic <base64>"
  allowSelfSigned?: boolean; // ONLY set true in isolated lab environments; adds CA to trust store instead
}

// Parse a single labels string: label1="v1",label2="v2"
function parseLabels(labelsStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const m of labelsStr.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

// Prometheus text exposition: metric{labels} value [timestamp_ms]
// or: metric value [timestamp_ms]
function parsePrometheusText(text: string, config: PrometheusCollectorConfig): CanonicalEvent[] {
  const entityLabel = config.entityLabel;
  const urlHostname = (() => { try { return new URL(config.url).hostname; } catch { return 'unknown'; } })();
  const events: CanonicalEvent[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // With labels: name{...} value [ts]
    let metricName: string;
    let labels: Record<string, string> = {};
    let valueStr: string;
    let tsStr: string | undefined;

    const withLabels = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([\S]+)(?:\s+(\d+))?$/);
    const noLabels = !withLabels && line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([\S]+)(?:\s+(\d+))?$/);

    if (withLabels) {
      [, metricName, , valueStr, tsStr] = withLabels as RegExpMatchArray;
      labels = parseLabels(withLabels[2]);
    } else if (noLabels) {
      [, metricName, valueStr, tsStr] = noLabels as RegExpMatchArray;
    } else {
      continue;
    }

    const value = parseFloat(valueStr);
    if (!isFinite(value)) continue;

    const entity =
      (entityLabel ? labels[entityLabel] : undefined) ??
      labels['instance'] ??
      labels['job'] ??
      urlHostname;

    // Convert metric_name to dot-notation type
    const type = metricName.replace(/_/g, '.');

    // Prometheus timestamps are in milliseconds
    const timestamp = tsStr ? new Date(parseInt(tsStr, 10)) : new Date();

    events.push(normalizeEvent({
      entity,
      type,
      attributes: { value, ...labels },
      timestamp,
    }, 'prometheus'));
  }

  return events;
}

function fetchText(url: string, authHeader?: string, timeoutMs = 10000, allowSelfSigned = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      timeout: timeoutMs,
      // rejectUnauthorized defaults to true (secure). Set allowSelfSigned in config only for
      // isolated lab endpoints — prefer adding the CA to your trust store instead.
      rejectUnauthorized: !allowSelfSigned,
      headers: authHeader ? { Authorization: authHeader } : undefined,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout scraping ${url}`)); });
  });
}

export class PrometheusCollector {
  readonly type = 'prometheus' as const;

  constructor(private config: PrometheusCollectorConfig) {
    if (!config.url) throw new Error('PrometheusCollector: url is required');
  }

  async collect(): Promise<CanonicalEvent[]> {
    const text = await fetchText(this.config.url, this.config.authHeader, this.config.timeoutMs, this.config.allowSelfSigned);
    return parsePrometheusText(text, this.config);
  }
}
