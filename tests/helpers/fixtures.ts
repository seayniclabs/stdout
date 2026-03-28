/**
 * Test data fixtures for StdOut Playwright tests.
 * All test data uses "test_" prefix to avoid collisions with production.
 */

export const testIncident = {
  title: 'test_nginx_502_after_deploy',
  description: 'test_description: nginx returning 502 Bad Gateway after deploying v2.1.0. Error logs show upstream connection timeout.',
  severity: 'high' as const,
  tags: 'test_docker, test_nginx',
};

export const testIncidentCritical = {
  title: 'test_database_connection_pool_exhausted',
  description: 'test_description: All database connections consumed. New queries hanging indefinitely.',
  severity: 'critical' as const,
  tags: 'test_postgres, test_critical',
};

export const testStack = {
  name: 'test_homelab_stack',
  description: '### nginx (nginx:alpine)\n- Ports: 80:80, 443:443\n- Networks: proxy\n\n### postgres (postgres:16)\n- Ports: 5432:5432\n- Networks: backend',
};

export const testDoc = {
  title: 'test_docker_restart_runbook',
  content: '# Docker Restart Runbook\n\n1. Check container logs: `docker logs <container>`\n2. Restart: `docker restart <container>`\n3. Verify: `docker ps`',
  docType: 'runbook',
  tags: 'test_docker, test_ops',
};

export const testMonitorHTTP = {
  name: 'test_example_monitor',
  type: 'http',
  target: 'https://example.com',
  interval: 60,
  timeout: 5000,
  expectedStatus: 200,
  retries: 3,
};

export const testMonitorTCP = {
  name: 'test_tcp_monitor',
  type: 'tcp',
  target: 'example.com:443',
  interval: 60,
  timeout: 5000,
  retries: 3,
};

export const testWebhookNotification = {
  channel: 'webhook',
  destination: 'https://httpbin.org/post',
  events: ['incident_created'],
};

export const testEmailNotification = {
  channel: 'email',
  destination: 'test_notify@example.com',
  events: ['incident_created'],
};

export const scannerPayload = {
  version: '1.0.0',
  scanned_at: new Date().toISOString(),
  host: {
    os: 'macOS 15.3',
    arch: 'arm64',
    cpu_cores: 8,
    memory_gb: 32,
    disk: [
      { mount: '/', total_gb: 500, used_gb: 200 },
    ],
  },
  containers: [
    {
      name: 'test_nginx',
      image: 'nginx:alpine',
      status: 'running',
      ports: [{ host: 80, container: 80 }],
      networks: ['proxy'],
      health: 'healthy',
    },
    {
      name: 'test_postgres',
      image: 'postgres:16',
      status: 'running',
      ports: [{ host: 5432, container: 5432 }],
      networks: ['backend'],
    },
  ],
};

export const scannerPayloadWithDataSources = {
  ...scannerPayload,
  data_sources: {
    detected: [
      {
        name: 'Prometheus',
        type: 'metrics',
        endpoint: 'https://prom.example.com:9090',
        status: 'ok',
        accessible: true,
      },
    ],
    missing: [
      {
        type: 'grafana',
        recommendation: 'Install Grafana for dashboarding',
        reason: 'No Grafana instance detected',
      },
    ],
  },
};

/** SSRF test targets that MUST be blocked */
export const ssrfBlockedTargets = [
  { label: 'localhost', url: 'http://localhost:9443' },
  { label: 'RFC 1918 10.x', url: 'http://10.0.0.1' },
  { label: 'RFC 1918 172.16.x', url: 'http://172.16.0.1' },
  { label: 'RFC 1918 192.168.x', url: 'http://192.168.0.221:9443' },
  { label: 'Docker internal', url: 'http://host.docker.internal:3000' },
  { label: 'Cloud metadata', url: 'http://169.254.169.254/latest/meta-data' },
  { label: 'Link-local', url: 'http://169.254.1.1' },
  { label: 'Loopback IP', url: 'http://127.0.0.1:8080' },
  { label: 'IPv6 loopback', url: 'http://[::1]:8080' },
  { label: '0.0.0.0', url: 'http://0.0.0.0' },
  { label: 'Malformed URL', url: 'not://a-valid-url' },
];

/** Valid external target that should be allowed */
export const ssrfAllowedTarget = 'https://example.com';
