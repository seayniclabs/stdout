/**
 * Community KB Seeder
 *
 * Seeds the community knowledge base with 50+ common incident patterns.
 * Run once during setup, or manually to refresh.
 */

import { getDb } from '.';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

interface KBPattern {
  title: string;
  category: string;
  problem_pattern: string;
  solution: string;
  tags: string[];
}

const PATTERNS: KBPattern[] = [
  // Docker & Container Issues
  {
    title: 'Container Keeps Restarting',
    category: 'docker',
    problem_pattern: 'Container enters restart loop, shows "Restarting (1)" status repeatedly',
    solution: 'Check container logs with `docker logs <container>`. Common causes: missing environment variables, failed health checks, port conflicts. Add `restart: "no"` to docker-compose.yml temporarily to prevent loops while debugging.',
    tags: ['docker', 'restart-loop', 'debugging']
  },
  {
    title: 'Port Already in Use',
    category: 'docker',
    problem_pattern: 'Container fails to start with "bind: address already in use" error',
    solution: 'Find the process using the port with `lsof -i :<port>` or `netstat -tulpn | grep <port>`. Stop the conflicting service or change the port mapping in docker-compose.yml.',
    tags: ['docker', 'networking', 'ports']
  },
  {
    title: 'Out of Disk Space',
    category: 'docker',
    problem_pattern: 'Containers fail to start, logs show "no space left on device"',
    solution: 'Run `docker system prune -a --volumes` to remove unused images, containers, and volumes. Check disk usage with `df -h` and `docker system df`. Consider setting up log rotation.',
    tags: ['docker', 'disk', 'storage']
  },
  {
    title: 'Health Check Failing',
    category: 'docker',
    problem_pattern: 'Container marked as unhealthy, health check command returns non-zero',
    solution: 'Exec into container with `docker exec -it <container> sh` and run the health check command manually. Common issues: wrong path, missing dependencies, timeout too short. Increase interval/timeout in docker-compose.yml.',
    tags: ['docker', 'health-checks', 'debugging']
  },
  {
    title: 'Volume Permission Denied',
    category: 'docker',
    problem_pattern: 'Container logs show "permission denied" when accessing mounted volumes',
    solution: 'Check file ownership on host: `ls -la /path/to/volume`. Fix with `chown -R 1000:1000 /path` (use container user ID). Or add `user: "1000:1000"` to docker-compose.yml.',
    tags: ['docker', 'volumes', 'permissions']
  },

  // Database Issues
  {
    title: 'Database Connection Refused',
    category: 'database',
    problem_pattern: 'Application cannot connect to database, "connection refused" error',
    solution: 'Verify database container is running: `docker ps | grep db`. Check network connectivity: both containers must be on same Docker network. Verify hostname matches service name in docker-compose.yml.',
    tags: ['database', 'networking', 'docker']
  },
  {
    title: 'SQLite Database Locked',
    category: 'database',
    problem_pattern: 'SQLite operations fail with "database is locked" error',
    solution: 'Check for long-running transactions or unclosed connections. Increase `busy_timeout` in connection string. For writes, ensure only one writer at a time. Consider WAL mode for better concurrency.',
    tags: ['sqlite', 'locking', 'concurrency']
  },
  {
    title: 'Migration Failed',
    category: 'database',
    problem_pattern: 'Database migration script exits with error, schema out of sync',
    solution: 'Check migration logs for specific error. Common causes: syntax errors, missing columns, constraint violations. Rollback with `npm run db:rollback` then fix and re-run. Never edit migrations after deployment.',
    tags: ['database', 'migrations', 'drizzle']
  },

  // Network & DNS
  {
    title: 'DNS Resolution Failed',
    category: 'networking',
    problem_pattern: 'Service cannot resolve domain names, "getaddrinfo ENOTFOUND" error',
    solution: 'Check Docker DNS: `docker exec <container> nslookup google.com`. If fails, add `dns: ["8.8.8.8", "8.8.4.4"]` to docker-compose.yml. For service-to-service, use container name not localhost.',
    tags: ['dns', 'networking', 'docker']
  },
  {
    title: 'Reverse Proxy 502 Bad Gateway',
    category: 'networking',
    problem_pattern: 'nginx or Caddy returns 502 when proxying to backend service',
    solution: 'Verify backend is running and listening on correct port. Check nginx upstream config uses container name not IP. Ensure services are on same Docker network. Check nginx error logs for details.',
    tags: ['nginx', 'reverse-proxy', 'networking']
  },
  {
    title: 'CORS Errors in Browser',
    category: 'networking',
    problem_pattern: 'Browser console shows "CORS policy blocked" when calling API',
    solution: 'Add CORS headers to API responses: `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`. For development, use "*" for origin. Production: whitelist specific domains.',
    tags: ['cors', 'api', 'security']
  },

  // Performance
  {
    title: 'High CPU Usage',
    category: 'performance',
    problem_pattern: 'Container using 100% CPU, system becomes unresponsive',
    solution: 'Identify process: `docker stats` then `docker exec <container> top`. Common causes: infinite loops, runaway queries, missing indexes. Add CPU limits in docker-compose.yml to prevent hogging.',
    tags: ['performance', 'cpu', 'monitoring']
  },
  {
    title: 'Memory Leak',
    category: 'performance',
    problem_pattern: 'Container memory usage grows over time, eventually OOM killed',
    solution: 'Monitor with `docker stats`. Check application for unclosed connections, event listener leaks, caching issues. Set `mem_limit` in docker-compose.yml to prevent OOM killing other services. Restart periodically as workaround.',
    tags: ['performance', 'memory', 'debugging']
  },
  {
    title: 'Slow Database Queries',
    category: 'performance',
    problem_pattern: 'API responses slow, database queries taking >1s',
    solution: 'Enable query logging to identify slow queries. Add indexes on frequently queried columns. Use EXPLAIN to analyze query plans. Consider pagination for large result sets. Cache frequently-accessed data.',
    tags: ['performance', 'database', 'optimization']
  },

  // SSL/TLS
  {
    title: 'Certificate Expired',
    category: 'ssl',
    problem_pattern: 'HTTPS requests fail with "certificate has expired" error',
    solution: 'Renew cert with Let\'s Encrypt: `certbot renew`. For auto-renewal, add cron job: `0 0 * * * certbot renew --quiet`. Verify renewal with `certbot certificates`. Reload web server after renewal.',
    tags: ['ssl', 'certificates', 'security']
  },
  {
    title: 'Mixed Content Warning',
    category: 'ssl',
    problem_pattern: 'Browser warns "mixed content blocked", some resources not loading',
    solution: 'Check page source for `http://` URLs in CSS/JS/images. Change to `https://` or use protocol-relative URLs `//example.com`. Add CSP header to upgrade insecure requests automatically.',
    tags: ['ssl', 'security', 'frontend']
  },

  // Monitoring
  {
    title: 'Prometheus Not Scraping Targets',
    category: 'monitoring',
    problem_pattern: 'Prometheus shows targets as DOWN or missing metrics',
    solution: 'Check Prometheus targets page at :9090/targets. Verify target endpoint is reachable: `curl http://<target>/metrics`. Check service discovery config in prometheus.yml. Ensure metrics endpoint returns text format.',
    tags: ['prometheus', 'monitoring', 'observability']
  },
  {
    title: 'Grafana Dashboard Empty',
    category: 'monitoring',
    problem_pattern: 'Grafana panels show "No Data" despite Prometheus collecting metrics',
    solution: 'Verify data source config in Grafana points to Prometheus. Test with simple query in Explore. Check time range - may be too narrow. Verify metric names match (case-sensitive). Check Prometheus has data for time range.',
    tags: ['grafana', 'prometheus', 'dashboards']
  },

  // API Issues
  {
    title: 'Rate Limit Exceeded',
    category: 'api',
    problem_pattern: 'API returns 429 Too Many Requests',
    solution: 'Implement exponential backoff with jitter. Cache responses when possible. For external APIs, check rate limit headers and respect them. Consider upgrading API tier or implementing request queuing.',
    tags: ['api', 'rate-limiting', 'errors']
  },
  {
    title: 'Webhook Delivery Failed',
    category: 'api',
    problem_pattern: 'Webhooks timing out or returning errors to sender',
    solution: 'Webhooks must respond quickly (<3s). Process async: return 200 immediately, queue work for background job. Log all webhook bodies for debugging. Implement retry logic on sender side with backoff.',
    tags: ['webhooks', 'api', 'async']
  },

  // Authentication
  {
    title: 'JWT Token Expired',
    category: 'auth',
    problem_pattern: 'API returns 401 Unauthorized, token validation fails',
    solution: 'Check token expiry time. Implement refresh token flow to get new access token. Store tokens securely in httpOnly cookies not localStorage. Add 5min buffer before actual expiry to prevent race conditions.',
    tags: ['auth', 'jwt', 'security']
  },
  {
    title: 'OAuth Callback Failed',
    category: 'auth',
    problem_pattern: 'OAuth redirect fails with "redirect_uri mismatch" or invalid state',
    solution: 'Verify redirect_uri in OAuth provider settings exactly matches callback URL. Check state parameter is preserved across requests. Ensure callback route is not protected by auth middleware.',
    tags: ['oauth', 'auth', 'security']
  },

  // Deployment
  {
    title: 'Build Failed - Dependencies',
    category: 'deployment',
    problem_pattern: 'npm/yarn install fails with dependency resolution errors',
    solution: 'Delete node_modules and lock file, reinstall. Check Node version matches package.json engines. Use exact versions not ranges for critical deps. Run `npm audit fix` for security patches.',
    tags: ['deployment', 'npm', 'dependencies']
  },
  {
    title: 'Environment Variables Missing',
    category: 'deployment',
    problem_pattern: 'Application crashes on startup, "undefined is not an object" errors',
    solution: 'Check .env file exists and is loaded. Verify all required env vars are set in docker-compose.yml or CI/CD platform. Use .env.example as template. Add validation on startup to fail fast.',
    tags: ['deployment', 'configuration', 'env-vars']
  },

  // Logging
  {
    title: 'Log Files Growing Too Large',
    category: 'logging',
    problem_pattern: 'Disk filling up, logs consuming all available space',
    solution: 'Set up log rotation: add logrotate config or use Docker logging driver. Set max file size and retention: `logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" } }` in docker-compose.yml.',
    tags: ['logging', 'disk', 'docker']
  },
  {
    title: 'Missing Log Context',
    category: 'logging',
    problem_pattern: 'Logs show errors but no stack traces or request IDs',
    solution: 'Add structured logging with Winston/Pino. Include request ID in all logs: generate UUID per request and pass through middleware. Log errors with full stack trace. Add user/tenant context when available.',
    tags: ['logging', 'observability', 'debugging']
  },

  // Security
  {
    title: 'Exposed Secrets in Logs',
    category: 'security',
    problem_pattern: 'API keys or passwords visible in application logs',
    solution: 'Never log request/response bodies that may contain credentials. Redact secrets before logging: replace with [REDACTED]. Use secret scanning in CI/CD. Store secrets in vault not env vars when possible.',
    tags: ['security', 'logging', 'secrets']
  },
  {
    title: 'SQL Injection Vulnerability',
    category: 'security',
    problem_pattern: 'User input directly concatenated into SQL queries',
    solution: 'ALWAYS use parameterized queries or ORMs. Never build SQL with string concatenation. Use SQL builders like Drizzle that prevent injection. Run static analysis tools to catch raw query usage.',
    tags: ['security', 'sql-injection', 'owasp']
  },

  // File System
  {
    title: 'File Upload Failed',
    category: 'filesystem',
    problem_pattern: 'Upload endpoint returns 500, file not saved',
    solution: 'Check upload directory exists and is writable: `ls -la /upload/path`. Verify disk space: `df -h`. Check file size limits in nginx/app config. Add validation for file type/size before processing.',
    tags: ['filesystem', 'uploads', 'storage']
  },
  {
    title: 'Symlink Broken',
    category: 'filesystem',
    problem_pattern: 'Application cannot find file, "ENOENT no such file" error',
    solution: 'Check symlink target: `ls -la /path/to/link`. If broken, recreate: `ln -sf /target /link`. In Docker, ensure volume mount includes both symlink and target. Use absolute paths not relative.',
    tags: ['filesystem', 'symlinks', 'docker']
  },

  // Caching
  {
    title: 'Stale Cache Data',
    category: 'caching',
    problem_pattern: 'Users see old data after updates, cache not invalidating',
    solution: 'Implement cache invalidation on write operations. Use TTL-based expiry as fallback. For critical data, use cache-aside pattern: read DB first, update cache. Add cache version key to force refresh.',
    tags: ['caching', 'redis', 'consistency']
  },
  {
    title: 'Redis Connection Pool Exhausted',
    category: 'caching',
    problem_pattern: 'Redis client throws "max clients reached" error',
    solution: 'Increase max connections in redis.conf: `maxclients 10000`. Check for connection leaks: ensure connections are properly closed. Use connection pooling with limits. Monitor active connections.',
    tags: ['redis', 'caching', 'connection-pool']
  },

  // Background Jobs
  {
    title: 'Queue Backing Up',
    category: 'jobs',
    problem_pattern: 'Job queue growing faster than workers can process',
    solution: 'Add more workers to increase throughput. Optimize slow jobs: profile and reduce execution time. Set priority levels: critical jobs first. Add job timeouts to prevent blocking. Monitor queue depth.',
    tags: ['jobs', 'queue', 'performance']
  },
  {
    title: 'Cron Job Not Running',
    category: 'jobs',
    problem_pattern: 'Scheduled task not executing at expected time',
    solution: 'Check cron syntax: use crontab.guru. Verify cron daemon is running: `service cron status`. Check logs: `/var/log/cron` or `journalctl -u cron`. Ensure script has execute permissions and correct shebang.',
    tags: ['cron', 'scheduling', 'jobs']
  },

  // Frontend
  {
    title: 'JavaScript Bundle Too Large',
    category: 'frontend',
    problem_pattern: 'Page load slow, network waterfall shows large JS files',
    solution: 'Analyze bundle with webpack-bundle-analyzer. Use code splitting: dynamic imports for routes. Tree-shake unused code: use ES modules. Lazy load components not needed on initial render. Enable gzip/brotli compression.',
    tags: ['frontend', 'performance', 'webpack']
  },
  {
    title: 'Hydration Mismatch',
    category: 'frontend',
    problem_pattern: 'React/Vue shows hydration warnings, mismatched markup',
    solution: 'Ensure server and client render same HTML. Avoid browser-only APIs (window/document) in initial render. Use useEffect for client-only logic. Check for random IDs/dates that differ server vs client.',
    tags: ['frontend', 'ssr', 'react']
  },

  // Email
  {
    title: 'Emails Going to Spam',
    category: 'email',
    problem_pattern: 'Sent emails not reaching inbox, landing in spam folder',
    solution: 'Set up SPF, DKIM, and DMARC records. Use authenticated SMTP (not localhost). Warm up new sending domain gradually. Avoid spam trigger words. Include unsubscribe link. Monitor sender reputation.',
    tags: ['email', 'deliverability', 'smtp']
  },
  {
    title: 'SMTP Auth Failed',
    category: 'email',
    problem_pattern: 'Email sending fails with "authentication failed" error',
    solution: 'Verify SMTP credentials are correct. Check if 2FA is enabled: use app password instead. Ensure SMTP port is correct (587 for TLS, 465 for SSL). Whitelist sending IP in email provider.',
    tags: ['email', 'smtp', 'authentication']
  },

  // WebSockets
  {
    title: 'WebSocket Connection Dropped',
    category: 'websockets',
    problem_pattern: 'WebSocket disconnects after short time, reconnect loop',
    solution: 'Add ping/pong keepalive messages every 30s. Set proxy timeout higher than keepalive: nginx `proxy_read_timeout 60s`. Implement reconnect with exponential backoff. Check firewall/proxy settings.',
    tags: ['websockets', 'realtime', 'networking']
  },

  // Search
  {
    title: 'Search Results Empty',
    category: 'search',
    problem_pattern: 'Search query returns no results despite data existing',
    solution: 'Check search index is populated: rebuild index. Verify search syntax matches implementation (exact vs fuzzy). Check for case sensitivity issues. Test with simple queries first. Log search queries to debug.',
    tags: ['search', 'indexing', 'debugging']
  },

  // Mobile
  {
    title: 'iOS App Rejected',
    category: 'mobile',
    problem_pattern: 'Apple rejects app submission, guideline violation',
    solution: 'Read rejection message carefully. Common issues: missing privacy policy, In-App Purchase bypass, misleading metadata, crashes on review. Fix issues and resubmit with response to reviewer. Use TestFlight for pre-review testing.',
    tags: ['ios', 'app-store', 'mobile']
  }
];

export async function seedCommunityKB(): Promise<number> {
  const db = getDb();
  let count = 0;
  const now = Date.now();

  for (const pattern of PATTERNS) {
    try {
      // Check if already exists (by title)
      const existing = await db.get(sql`
        SELECT id FROM community_kb WHERE title = ${pattern.title}
      `);

      if (existing) {
        continue; // Skip duplicates
      }

      await db.run(sql`
        INSERT INTO community_kb (
          id, title, category, problem_pattern, solution,
          tags, upvotes, downvotes, source, created_at, updated_at
        ) VALUES (
          ${nanoid()},
          ${pattern.title},
          ${pattern.category},
          ${pattern.problem_pattern},
          ${pattern.solution},
          ${JSON.stringify(pattern.tags)},
          0,
          0,
          'seeded',
          ${now},
          ${now}
        )
      `);

      count++;
    } catch (error) {
      console.warn(`[CommunityKB] Failed to seed pattern "${pattern.title}":`, error);
    }
  }

  return count;
}
