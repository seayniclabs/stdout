/**
 * Load Test: Incident Creation & Auto-Fix
 * 
 * Simulates spike of 10K incidents hitting the system
 * Tests incident ingestion, deduplication, auto-fix queue, database write locks
 * 
 * Run: k6 run tests/load/incidents-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
const incidentCreations = new Counter('incident_creations');
const incidentDeduplications = new Counter('incident_deduplications');
const autoFixTriggers = new Counter('autofix_triggers');
const incidentLatency = new Trend('incident_creation_latency_ms');
const errorRate = new Rate('errors');

// Spike test configuration: ramp to 1000 VUs in 10 seconds, hold for 1 minute
export const options = {
  stages: [
    { duration: '10s', target: 1000 },  // Rapid ramp-up (spike)
    { duration: '1m', target: 1000 },   // Sustain spike
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // 95% under 2s during spike
    http_req_failed: ['rate<0.05'],      // Error rate < 5%
    incident_creations: ['count>10000'], // Must create at least 10K incidents
  },
};

const BASE_URL = __ENV.STDOUT_URL || 'http://localhost:4321';
const INCIDENT_PATTERNS = [
  { title: 'Disk space critical', severity: 'critical', description: 'Disk usage at 95%' },
  { title: 'Memory usage high', severity: 'high', description: 'Memory at 85% capacity' },
  { title: 'CPU spike detected', severity: 'medium', description: 'CPU sustained > 80%' },
  { title: 'Service unreachable', severity: 'critical', description: 'Service timeout after 30s' },
  { title: 'Database connection pool exhausted', severity: 'high', description: 'No available connections' },
];

export function setup() {
  // Login as admin
  const loginRes = http.post(`${BASE_URL}/app/login`, {
    email: 'admin@stdout.local',
    password: 'Admin123!secure',
    _csrf: 'test-token',
  });
  
  const cookies = loginRes.cookies;
  return {
    sessionCookie: cookies.session_id?.[0]?.value || '',
    csrfToken: 'test-csrf-token',
  };
}

export default function (data) {
  const headers = {
    'Cookie': `session_id=${data.sessionCookie}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': data.csrfToken,
  };
  
  // Pick random incident pattern
  const pattern = INCIDENT_PATTERNS[Math.floor(Math.random() * INCIDENT_PATTERNS.length)];
  
  const incidentPayload = JSON.stringify({
    title: `${pattern.title} - ${__VU}-${__ITER}`,
    severity: pattern.severity,
    description: pattern.description,
    source: 'load-test',
    monitor_id: null,  // Simulating manual incident creation
  });
  
  const start = Date.now();
  const createRes = http.post(`${BASE_URL}/app/api/incidents`, incidentPayload, { headers });
  const duration = Date.now() - start;
  
  const success = check(createRes, {
    'incident created': (r) => r.status === 200 || r.status === 201,
    'has incident ID': (r) => {
      try {
        return JSON.parse(r.body).id !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (success) {
    incidentCreations.add(1);
    incidentLatency.add(duration);
    
    // Check if auto-fix was triggered (would appear in response)
    try {
      const body = JSON.parse(createRes.body);
      if (body.autofix_suggestions && body.autofix_suggestions.length > 0) {
        autoFixTriggers.add(1);
      }
    } catch (e) {
      // Ignore parse errors
    }
  } else {
    errorRate.add(1);
    
    // Check for deduplication (409 Conflict)
    if (createRes.status === 409) {
      incidentDeduplications.add(1);
    }
  }
  
  // No sleep during spike test - create as fast as possible
}

export function teardown(data) {
  console.log('\n=== Incident Spike Test Summary ===');
  console.log(`Incidents created: ${incidentCreations.count}`);
  console.log(`Deduplications: ${incidentDeduplications.count}`);
  console.log(`Auto-fix triggers: ${autoFixTriggers.count}`);
  console.log(`Average latency: ${incidentLatency.avg}ms`);
  console.log(`Error rate: ${(errorRate.value * 100).toFixed(2)}%`);
}
