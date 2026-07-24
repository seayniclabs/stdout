/**
 * Load Test: Monitor Creation & Checks
 * 
 * Simulates 1000 monitors with regular check intervals
 * Tests database write performance, queue throughput, worker scaling
 * 
 * Run: k6 run tests/load/monitors-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const monitorCreations = new Counter('monitor_creations');
const checkExecutions = new Counter('check_executions');
const checkLatency = new Trend('check_latency_ms');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 virtual users
    { duration: '5m', target: 100 },   // Stay at 100 for 5 minutes
    { duration: '2m', target: 500 },   // Ramp up to 500
    { duration: '10m', target: 500 },  // Stay at 500 for 10 minutes (creates ~1000 monitors)
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],    // Error rate must be below 1%
    monitor_creations: ['count>1000'], // Must create at least 1000 monitors
  },
};

const BASE_URL = __ENV.STDOUT_URL || 'http://localhost:4321';
let sessionCookie;
let csrfToken;

// Setup: Authenticate once per VU
export function setup() {
  // Login as admin
  const loginRes = http.post(`${BASE_URL}/app/login`, {
    email: 'admin@stdout.local',
    password: 'Admin123!secure',
    _csrf: 'test-token',  // Will be replaced with real token in production
  });
  
  const cookies = loginRes.cookies;
  return {
    sessionCookie: cookies.session_id?.[0]?.value || '',
    csrfToken: 'test-csrf-token',  // Extract from response in production
  };
}

// Main test loop
export default function (data) {
  sessionCookie = data.sessionCookie;
  csrfToken = data.csrfToken;
  
  const headers = {
    'Cookie': `session_id=${sessionCookie}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  };
  
  // Create a monitor
  const monitorPayload = JSON.stringify({
    name: `Load Test Monitor ${__VU}-${__ITER}`,
    url: `https://example.com/api/health/${__VU}/${__ITER}`,
    type: 'http',
    interval: 300,  // 5 minutes
    timeout: 30,
    enabled: true,
  });
  
  const createRes = http.post(`${BASE_URL}/app/api/monitors`, monitorPayload, { headers });
  
  check(createRes, {
    'monitor created': (r) => r.status === 200 || r.status === 201,
    'has monitor ID': (r) => JSON.parse(r.body).id !== undefined,
  });
  
  if (createRes.status === 200 || createRes.status === 201) {
    monitorCreations.add(1);
    const monitorId = JSON.parse(createRes.body).id;
    
    // Trigger immediate check
    const checkStart = Date.now();
    const checkRes = http.post(`${BASE_URL}/app/api/monitors/${monitorId}/check`, null, { headers });
    const checkDuration = Date.now() - checkStart;
    
    check(checkRes, {
      'check completed': (r) => r.status === 200,
    });
    
    if (checkRes.status === 200) {
      checkExecutions.add(1);
      checkLatency.add(checkDuration);
    }
  }
  
  // Random think time (1-5 seconds) to simulate real user behavior
  sleep(Math.random() * 4 + 1);
}

// Teardown: Report summary
export function teardown(data) {
  console.log('\n=== Load Test Summary ===');
  console.log(`Monitors created: ${monitorCreations.count}`);
  console.log(`Checks executed: ${checkExecutions.count}`);
  console.log(`Average check latency: ${checkLatency.avg}ms`);
}
