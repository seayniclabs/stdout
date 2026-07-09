/**
 * SyslogReceiver — UDP listener for RFC5424 (and RFC3164 fallback) syslog messages.
 * Runs async on a UDP socket; does not block the main request loop.
 * Structured JSON embedded in the syslog message body is extracted into attributes.
 */
import dgram from 'node:dgram';
import { type CanonicalEvent, normalizeEvent } from './normalize';

export interface SyslogConfig {
  port?: number;  // default 514
  host?: string;  // default '0.0.0.0' (all interfaces)
}

const FACILITIES = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news',
  'uucp', 'cron', 'security', 'ftp', 'ntp', 'logaudit', 'logalert', 'clock',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7',
];
const SEVERITIES = ['emerg', 'alert', 'crit', 'error', 'warning', 'notice', 'info', 'debug'];

function parsePriority(pri: number): { facility: string; severity: string } {
  return {
    facility: FACILITIES[Math.floor(pri / 8)] ?? 'unknown',
    severity: SEVERITIES[pri % 8] ?? 'unknown',
  };
}

function tryParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s.trim()); } catch { return {}; }
}

// Syslog messages are bounded to 65535 bytes by UDP; cap display-side at 64KB
const MAX_MSG_BYTES = 65535;

function parseSyslog(raw: string): CanonicalEvent | null {
  const priMatch = raw.match(/^<(\d+)>(.*)/s);
  if (!priMatch) return null;

  const pri = parseInt(priMatch[1], 10);
  if (!isFinite(pri) || pri < 0 || pri > 191) return null;
  const rest = priMatch[2];
  const { facility, severity } = parsePriority(pri);

  // RFC5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD] MSG
  const rfc5424 = rest.match(
    /^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+|-)\s+(.*)/s,
  );
  if (rfc5424) {
    const [, , timestampStr, hostname, appName, , , , message] = rfc5424;
    const entity = hostname === '-' ? 'unknown' : hostname;
    const ts = timestampStr === '-' ? new Date() : new Date(timestampStr);
    const safeMsg = message.trim().slice(0, MAX_MSG_BYTES);
    const jsonFields = tryParseJson(safeMsg);

    return normalizeEvent({
      entity,
      type: `syslog.${appName === '-' ? 'message' : appName}`,
      attributes: { severity, facility, hostname, appName, message: safeMsg, ...jsonFields },
      timestamp: Number.isNaN(ts.getTime()) ? new Date() : ts,
    }, 'syslog');
  }

  // RFC3164: TIMESTAMP HOSTNAME TAG: MSG  (no year — use current year)
  const rfc3164 = rest.match(/^([A-Za-z]{3}\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+([^:]+):\s*(.*)/s);
  if (rfc3164) {
    const [, , hostname, tag, message] = rfc3164;
    return normalizeEvent({
      entity: hostname,
      type: `syslog.${tag.trim()}`,
      attributes: { severity, facility, hostname, tag: tag.trim(), message: message.trim().slice(0, MAX_MSG_BYTES) },
      timestamp: new Date(),
    }, 'syslog');
  }

  // Fallback: unknown format
  return normalizeEvent({
    entity: 'unknown',
    type: 'syslog.message',
    attributes: { severity, facility, raw: rest.slice(0, MAX_MSG_BYTES) },
    timestamp: new Date(),
  }, 'syslog');
}

type EventCallback = (event: CanonicalEvent) => void;

export class SyslogReceiver {
  readonly type = 'syslog' as const;
  private socket: dgram.Socket | null = null;
  private readonly port: number;
  private readonly host: string;

  constructor(config: SyslogConfig = {}) {
    this.port = config.port ?? 514;
    this.host = config.host ?? '0.0.0.0';
  }

  start(onEvent: EventCallback): void {
    if (this.socket) return; // already running

    this.socket = dgram.createSocket('udp4');

    this.socket.on('message', (msg) => {
      try {
        const raw = msg.toString('utf8').slice(0, MAX_MSG_BYTES);
        const event = parseSyslog(raw);
        if (event) onEvent(event);
      } catch (err) {
        console.error('[syslog] parse error:', err);
      }
    });

    this.socket.on('error', (err) => {
      console.error('[syslog] socket error:', err);
    });

    this.socket.bind(this.port, this.host, () => {
      console.log(`[syslog] listening on UDP ${this.host}:${this.port}`);
    });
  }

  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  isRunning(): boolean {
    return this.socket !== null;
  }
}
