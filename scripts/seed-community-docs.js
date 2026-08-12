/**
 * Seed Community Documentation
 * Run once on first install to populate knowledge base with example docs
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const DB_PATH = process.env.DB_PATH || '/data/stdout.db';

// 5 Community Packs as promised on product page
const COMMUNITY_DOCS = [
  {
    id: 'community_ssh_hardening',
    type: 'runbook',
    title: 'SSH Server Security Hardening',
    slug: 'ssh-server-security-hardening',
    content: `# SSH Server Security Hardening

## Problem

Default SSH configurations are insecure and vulnerable to brute-force attacks, weak authentication, and protocol exploits.

## Solution

### 1. Disable Root Login

Edit \`/etc/ssh/sshd_config\`:

\`\`\`
PermitRootLogin no
\`\`\`

### 2. Use SSH Keys (Disable Password Auth)

\`\`\`
PasswordAuthentication no
PubkeyAuthentication yes
\`\`\`

### 3. Change Default Port

\`\`\`
Port 2222
\`\`\`

### 4. Limit User Access

\`\`\`
AllowUsers alice bob
\`\`\`

### 5. Enable Two-Factor Authentication

Install Google Authenticator PAM module:

\`\`\`bash
sudo apt install libpam-google-authenticator
google-authenticator
\`\`\`

Add to \`/etc/pam.d/sshd\`:
\`\`\`
auth required pam_google_authenticator.so
\`\`\`

### 6. Restart SSH

\`\`\`bash
sudo systemctl restart sshd
\`\`\`

## Verification

- ✓ Root login attempts fail
- ✓ Password auth disabled
- ✓ 2FA required for login
- ✓ Connection on custom port only

## References

- CIS Benchmark for SSH
- NIST SP 800-123`,
    tags: JSON.stringify(['ssh', 'security', 'hardening', 'linux']),
    visibility: 'public'
  },
  {
    id: 'community_packet_loss',
    type: 'runbook',
    title: 'Network Packet Loss Diagnosis',
    slug: 'network-packet-loss-diagnosis',
    content: `# Network Packet Loss Diagnosis

## Problem

Intermittent packet loss causes slow or failed connections. Symptoms:
- High ping times
- Timeouts
- Degraded application performance

## Diagnosis Steps

### 1. Confirm Packet Loss

\`\`\`bash
ping -c 100 8.8.8.8
# Look for "packet loss %" in summary
\`\`\`

### 2. Identify Location

Test each hop:

\`\`\`bash
mtr 8.8.8.8
# Shows packet loss at each hop
\`\`\`

### 3. Check Interface Errors

\`\`\`bash
ip -s link show eth0
# Look for TX/RX errors, drops, overruns
\`\`\`

### 4. Check System Load

\`\`\`bash
top
vmstat 1
# High CPU or memory can cause drops
\`\`\`

## Common Causes

1. **Physical Cable Issues**
   - Replace ethernet cable
   - Test with different port/cable

2. **Network Congestion**
   - Implement QoS
   - Upgrade bandwidth

3. **Faulty Network Card**
   - Check \`dmesg | grep eth\`
   - Update drivers

4. **Firewall/Router Issues**
   - Check iptables rules
   - Update firmware

## Resolution

Once cause identified:
- Document findings
- Apply fix
- Re-test with ping/mtr for 24h
- Monitor over time

## Tools

- \`ping\` - basic connectivity
- \`mtr\` - combined traceroute/ping
- \`iperf3\` - bandwidth testing
- \`tcpdump\` - packet capture`,
    tags: JSON.stringify(['networking', 'packet-loss', 'diagnosis', 'troubleshooting']),
    visibility: 'public'
  },
  {
    id: 'community_db_slow_query',
    type: 'runbook',
    title: 'Database Slow Query Optimization',
    slug: 'database-slow-query-optimization',
    content: `# Database Slow Query Optimization

## Problem

Database queries taking >1 second causing:
- Slow API responses
- Timeouts
- High server load

## Diagnosis

### 1. Identify Slow Queries

**PostgreSQL:**
\`\`\`sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
\`\`\`

**MySQL:**
\`\`\`bash
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
# Check /var/log/mysql/slow-query.log
\`\`\`

### 2. Analyze Query Plan

\`\`\`sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';
\`\`\`

Look for:
- Sequential scans (bad)
- Index scans (good)
- High row counts

## Optimization Strategies

### 1. Add Indexes

\`\`\`sql
CREATE INDEX idx_users_email ON users(email);
\`\`\`

### 2. Optimize Query

Before:
\`\`\`sql
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
\`\`\`

After:
\`\`\`sql
SELECT * FROM orders
WHERE created_at >= '2024-01-01'
  AND created_at < '2025-01-01';
\`\`\`

### 3. Use Pagination

\`\`\`sql
SELECT * FROM logs
ORDER BY created_at DESC
LIMIT 100 OFFSET 0;
\`\`\`

### 4. Denormalize for Reads

Add computed columns:
\`\`\`sql
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(10,2);
CREATE INDEX idx_orders_total ON orders(total_amount);
\`\`\`

## Verification

- Re-run EXPLAIN ANALYZE
- Check execution time < 100ms
- Monitor under load

## Prevention

- Index foreign keys
- Use covering indexes
- Regularly VACUUM (PostgreSQL)
- Analyze query patterns monthly`,
    tags: JSON.stringify(['database', 'performance', 'sql', 'optimization']),
    visibility: 'public'
  },
  {
    id: 'community_k8s_service_discovery',
    type: 'runbook',
    title: 'Kubernetes Service Discovery Issues',
    slug: 'kubernetes-service-discovery-issues',
    content: `# Kubernetes Service Discovery Issues

## Problem

Services cannot discover each other. Symptoms:
- \`nslookup\` fails for service names
- Connection refused
- \`getaddrinfo ENOTFOUND\` errors

## Diagnosis

### 1. Verify Service Exists

\`\`\`bash
kubectl get svc -n production
\`\`\`

### 2. Check DNS Resolution

From inside a pod:

\`\`\`bash
kubectl exec -it <pod-name> -- nslookup backend-service
\`\`\`

Should resolve to ClusterIP.

### 3. Check CoreDNS

\`\`\`bash
kubectl get pods -n kube-system | grep coredns
kubectl logs -n kube-system <coredns-pod>
\`\`\`

### 4. Verify Network Policy

\`\`\`bash
kubectl get networkpolicies -n production
\`\`\`

## Common Issues

### Issue 1: Wrong Service Name

Use fully qualified name:
\`\`\`
backend-service.production.svc.cluster.local
\`\`\`

Or short form (same namespace):
\`\`\`
backend-service
\`\`\`

### Issue 2: Service Port Mismatch

Check service definition:
\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  ports:
  - port: 80        # Service port
    targetPort: 8080 # Container port
\`\`\`

Connect to port 80, not 8080.

### Issue 3: Selector Mismatch

Service selector must match pod labels:

\`\`\`bash
kubectl describe svc backend-service
kubectl get pods --show-labels
\`\`\`

### Issue 4: CoreDNS Not Running

\`\`\`bash
kubectl scale deployment -n kube-system coredns --replicas=2
\`\`\`

## Resolution

1. Fix service/selector mismatch
2. Restart CoreDNS if needed
3. Update app to use correct service name
4. Test with \`kubectl exec\` curl

## Verification

\`\`\`bash
kubectl exec -it frontend-pod -- curl http://backend-service/health
# Should return 200 OK
\`\`\``,
    tags: JSON.stringify(['kubernetes', 'networking', 'dns', 'troubleshooting']),
    visibility: 'public'
  },
  {
    id: 'community_k8s_crashloop',
    type: 'runbook',
    title: 'Kubernetes Pod CrashLoopBackOff Troubleshooting',
    slug: 'kubernetes-pod-crashloopbackoff',
    content: `# Kubernetes Pod CrashLoopBackOff

## Problem

Pod enters CrashLoopBackOff state, restarting repeatedly.

## Diagnosis

### 1. Check Pod Status

\`\`\`bash
kubectl get pods
# NAME                    READY   STATUS             RESTARTS
# myapp-5d4c7b9f8-xyz12   0/1     CrashLoopBackOff   5
\`\`\`

### 2. View Logs

\`\`\`bash
kubectl logs myapp-5d4c7b9f8-xyz12
kubectl logs myapp-5d4c7b9f8-xyz12 --previous  # Previous container
\`\`\`

### 3. Describe Pod

\`\`\`bash
kubectl describe pod myapp-5d4c7b9f8-xyz12
# Look for Events section
\`\`\`

### 4. Check Events

\`\`\`bash
kubectl get events --sort-by='.lastTimestamp'
\`\`\`

## Common Causes

### 1. Application Crash

Check logs for:
- Uncaught exceptions
- Failed health checks
- Missing dependencies

### 2. Failed Liveness Probe

\`\`\`yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30  # Give app time to start
  periodSeconds: 10
\`\`\`

### 3. Missing ConfigMap/Secret

\`\`\`bash
kubectl get configmap
kubectl get secret
\`\`\`

### 4. Resource Limits

Pod OOMKilled:

\`\`\`yaml
resources:
  limits:
    memory: "512Mi"  # Increase if OOMKilled
  requests:
    memory: "256Mi"
\`\`\`

### 5. Wrong Command/Args

\`\`\`yaml
command: ["node"]
args: ["server.js"]  # Verify path is correct
\`\`\`

### 6. Missing Environment Variables

\`\`\`bash
kubectl exec myapp-pod -- env
\`\`\`

## Resolution Steps

1. Review logs for root cause
2. Fix application code OR deployment config
3. Apply changes:
   \`\`\`bash
   kubectl apply -f deployment.yaml
   \`\`\`
4. Watch rollout:
   \`\`\`bash
   kubectl rollout status deployment/myapp
   \`\`\`

## Prevention

- Add health check endpoints
- Use appropriate resource limits
- Test locally before deploying
- Use \`kubectl apply --dry-run=client\`
- Implement gradual rollouts

## Quick Fixes

Temporarily disable probe while debugging:

\`\`\`bash
kubectl edit deployment myapp
# Remove livenessProbe section
# Save and exit
\`\`\`

Get shell access (if container stays up briefly):

\`\`\`bash
kubectl run -it --rm debug --image=busybox --restart=Never -- sh
\`\`\``,
    tags: JSON.stringify(['kubernetes', 'crashloop', 'troubleshooting', 'pods']),
    visibility: 'public'
  }
];

async function seedCommunityDocs() {
  console.log('[seed-community-docs] Starting...');

  const db = new Database(DB_PATH);

  try {
    // Check how many docs already exist
    const existingCount = db.prepare("SELECT COUNT(*) as count FROM docs WHERE visibility = 'public'").get();

    if (existingCount.count > 0) {
      console.log(`[seed-community-docs] ${existingCount.count} public docs already exist, skipping`);
      db.close();
      return;
    }

    const now = Date.now();
    let seeded = 0;

    const insertStmt = db.prepare(`
      INSERT INTO docs (id, type, title, slug, content, tags, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const doc of COMMUNITY_DOCS) {
      try {
        insertStmt.run(
          doc.id,
          doc.type,
          doc.title,
          doc.slug,
          doc.content,
          doc.tags,
          doc.visibility,
          now,
          now
        );
        seeded++;
        console.log(`[seed-community-docs] Seeded: ${doc.title}`);
      } catch (error) {
        console.warn(`[seed-community-docs] Failed to seed "${doc.title}":`, error.message);
      }
    }

    db.close();
    console.log(`[seed-community-docs] Seeded ${seeded} community docs`);

  } catch (error) {
    console.error('[seed-community-docs] Error:', error);
    db.close();
    process.exit(1);
  }
}

seedCommunityDocs();
