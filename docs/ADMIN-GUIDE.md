# StdOut Admin Guide

Administrator guide for database management, backups, performance tuning, and operations.

## Table of Contents

- [Database Management](#database-management)
- [Backup & Restore](#backup--restore)
- [Performance Tuning](#performance-tuning)
- [Monitoring StdOut](#monitoring-stdout)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## Database Management

### SQLite vs PostgreSQL

**When to use SQLite (default):**
- < 100 monitors
- < 10,000 total incidents
- Single-server deployment
- < 100 writes/minute
- Development/testing

**When to use PostgreSQL:**
- 100+ monitors
- 10,000+ incidents
- Multi-instance deployment
- Heavy write load (>100/min)
- Need connection pooling

**Performance comparison:**

| Metric | SQLite | PostgreSQL |
|--------|--------|------------|
| Concurrent writes | Limited | Excellent |
| Query performance | Fast (<10ms) | Fast (<10ms) |
| Max database size | ~140TB | Unlimited |
| Replication | Manual | Built-in |
| Backups | File copy | pg_dump |

### SQLite Administration

**Database location:**
```bash
# Default path
/data/stdout.db

# Check size
du -sh /data/stdout.db

# Vacuum (reclaim space)
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "VACUUM;"

# Analyze (update query planner stats)
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "ANALYZE;"
```

**Integrity check:**
```bash
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "PRAGMA integrity_check;"

# Expected output: "ok"
```

**WAL mode (recommended):**
```bash
# Check current mode
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "PRAGMA journal_mode;"

# Enable WAL (if not already)
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "PRAGMA journal_mode=WAL;"
```

**WAL benefits:**
- Better concurrency (readers don't block writers)
- Faster commits
- Atomic checkpointing

### PostgreSQL Administration

**Connect to database:**
```bash
docker exec -it stdout-postgres psql -U stdout -d stdout
```

**Common tasks:**
```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('stdout'));

-- Check table sizes
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- Vacuum full (reclaim space)
VACUUM FULL;

-- Analyze (update stats)
ANALYZE;

-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Connection pooling:**
```yaml
# docker-compose.postgres.yml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer:latest
    environment:
      - DATABASE_URL=postgres://stdout:${POSTGRES_PASSWORD}@postgres:5432/stdout
      - POOL_MODE=transaction
      - MAX_CLIENT_CONN=100
      - DEFAULT_POOL_SIZE=25
    ports:
      - "6432:6432"
```

## Backup & Restore

### Automated Backups

**Enable automatic backups:**
```bash
# Add to .env
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * *"  # Daily at 2 AM
BACKUP_RETENTION_DAYS=30
BACKUP_PATH=/data/backups
```

**Backup script (SQLite):**
```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR=/data/backups
DATE=$(date +%Y%m%d-%H%M%S)
DB_PATH=/data/stdout.db

mkdir -p $BACKUP_DIR

# Backup database
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/stdout-$DATE.db'"

# Compress
gzip $BACKUP_DIR/stdout-$DATE.db

# Clean old backups (keep last 30 days)
find $BACKUP_DIR -name "stdout-*.db.gz" -mtime +30 -delete

echo "Backup complete: stdout-$DATE.db.gz"
```

**Run backup manually:**
```bash
docker exec stdout-stdout-1 /app/scripts/backup.sh
```

### PostgreSQL Backup

**pg_dump (recommended):**
```bash
# Full backup
docker exec stdout-postgres pg_dump -U stdout -Fc stdout > backup-$(date +%Y%m%d).dump

# Plain SQL backup
docker exec stdout-postgres pg_dump -U stdout stdout > backup-$(date +%Y%m%d).sql

# Compressed
docker exec stdout-postgres pg_dump -U stdout stdout | gzip > backup-$(date +%Y%m%d).sql.gz
```

**Continuous archiving (WAL):**
```yaml
# docker-compose.postgres.yml
services:
  postgres:
    command:
      - "postgres"
      - "-c"
      - "wal_level=replica"
      - "-c"
      - "archive_mode=on"
      - "-c"
      - "archive_command=cp %p /backups/wal/%f"
    volumes:
      - ./backups/wal:/backups/wal
```

### Restore

**SQLite restore:**
```bash
# Stop StdOut
docker compose down

# Restore backup
gunzip backup-20260810.db.gz
cp backup-20260810.db /data/stdout.db

# Fix permissions
sudo chown 1000:1000 /data/stdout.db

# Start StdOut
docker compose up -d

# Verify
curl http://localhost:8112/api/health
```

**PostgreSQL restore:**
```bash
# Stop StdOut (keep postgres running)
docker compose stop stdout

# Drop existing database
docker exec stdout-postgres psql -U stdout -c "DROP DATABASE stdout;"
docker exec stdout-postgres psql -U stdout -c "CREATE DATABASE stdout;"

# Restore from dump
docker exec -i stdout-postgres pg_restore -U stdout -d stdout < backup-20260810.dump

# Or from SQL file
docker exec -i stdout-postgres psql -U stdout stdout < backup-20260810.sql

# Start StdOut
docker compose start stdout
```

### Disaster Recovery

**Off-site backups (recommended):**
```bash
# rsync to remote server
rsync -avz /data/backups/ backup-server:/backups/stdout/

# AWS S3
aws s3 sync /data/backups/ s3://my-backups/stdout/

# Automated via cron
0 3 * * * rsync -avz /data/backups/ backup-server:/backups/stdout/
```

**Recovery Time Objective (RTO):**
- SQLite: < 5 minutes
- PostgreSQL: < 15 minutes (depends on database size)

**Recovery Point Objective (RPO):**
- Daily backups: Up to 24 hours of data loss
- Hourly backups: Up to 1 hour of data loss
- WAL archiving (PostgreSQL): Near-zero data loss

## Performance Tuning

### Database Optimization

**SQLite:**
```sql
-- WAL mode (enables concurrent reads)
PRAGMA journal_mode=WAL;

-- Increase cache (MB)
PRAGMA cache_size=-64000;  -- 64MB

-- Temp store in memory
PRAGMA temp_store=MEMORY;

-- Synchronous mode (trades durability for speed)
PRAGMA synchronous=NORMAL;  -- Or OFF for maximum speed (risky)
```

**PostgreSQL:**
```sql
-- Increase shared buffers (25% of RAM)
ALTER SYSTEM SET shared_buffers = '1GB';

-- Effective cache size (50-75% of RAM)
ALTER SYSTEM SET effective_cache_size = '3GB';

-- Work memory (for sorts/joins)
ALTER SYSTEM SET work_mem = '16MB';

-- Maintenance work memory (for vacuums)
ALTER SYSTEM SET maintenance_work_mem = '256MB';

-- Max connections
ALTER SYSTEM SET max_connections = '200';

-- Apply changes
SELECT pg_reload_conf();
```

### Index Optimization

**Check missing indexes:**
```sql
-- PostgreSQL
SELECT 
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan
  AND seq_tup_read > 0
ORDER BY seq_tup_read DESC
LIMIT 10;
```

**Add indexes for slow queries:**
```sql
-- Example: Index on incident severity + status
CREATE INDEX idx_incidents_severity_status 
  ON incidents(severity, status);

-- Partial index for active incidents only
CREATE INDEX idx_incidents_active 
  ON incidents(status) 
  WHERE status IN ('active', 'investigating');
```

### Application Performance

**Monitor response times:**
```bash
# Check health endpoint
time curl http://localhost:8112/api/health

# Expected: < 100ms
```

**Slow query log (PostgreSQL):**
```sql
-- Enable slow query logging (queries > 1 second)
ALTER SYSTEM SET log_min_duration_statement = 1000;

-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Memory usage:**
```bash
# Check container memory
docker stats stdout-stdout-1

# Expected:
# - Small deployment: 200-500MB
# - Large deployment: 500MB-2GB
```

## Monitoring StdOut

### Health Checks

**API endpoint:**
```bash
curl http://localhost:8112/api/health | jq

# Expected response:
# {
#   "status": "ok",
#   "version": "1.2.0",
#   "dependencies": {
#     "database": "ok",
#     "riggins": "ok"
#   }
# }
```

**Database health:**
```bash
# SQLite
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "SELECT COUNT(*) FROM incidents;"

# PostgreSQL
docker exec stdout-postgres psql -U stdout -d stdout -c "SELECT COUNT(*) FROM incidents;"
```

### Metrics

**Key metrics to track:**
- Incidents created per day
- Average resolution time
- Monitor check latency
- Database query time
- API response time
- Disk usage growth

**Grafana dashboard (optional):**
```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## Troubleshooting

### Common Issues

**Database locked:**
```bash
# SQLite: Check for stuck processes
lsof /data/stdout.db

# Kill stuck process
kill -9 <PID>

# Enable WAL mode to reduce locking
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "PRAGMA journal_mode=WAL;"
```

**Out of disk space:**
```bash
# Check usage
df -h

# Clean old logs
docker exec stdout-stdout-1 npm run logs:rotate

# Vacuum database
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "VACUUM;"

# Clean Docker
docker system prune -a --volumes
```

**Slow queries:**
```bash
# SQLite: Check query plan
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "EXPLAIN QUERY PLAN SELECT * FROM incidents WHERE status='active';"

# Add missing index
docker exec stdout-stdout-1 sqlite3 /data/stdout.db "CREATE INDEX idx_incidents_status ON incidents(status);"
```

**Memory issues:**
```bash
# Check memory usage
docker stats

# Increase container memory limit
# docker-compose.yml
services:
  stdout:
    deploy:
      resources:
        limits:
          memory: 2G
```

## Security

### Access Control

**User roles:**
- **Superadmin** - Full access, can delete data
- **Admin** - Manage users, monitors, incidents
- **Member** - View and create incidents

**Create users:**
```bash
# Via UI: Settings → Team → Invite User
# Or via API:
curl -X POST http://localhost:8112/app/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "role": "member",
    "displayName": "New User"
  }'
```

### Database Security

**PostgreSQL:**
```sql
-- Change default password
ALTER USER stdout WITH PASSWORD 'new-secure-password';

-- Restrict connections
-- pg_hba.conf:
# host  stdout  stdout  172.18.0.0/16  scram-sha-256
```

**SQLite:**
```bash
# File permissions
chmod 640 /data/stdout.db
chown stdout:stdout /data/stdout.db

# Encrypt backups
gpg --encrypt --recipient admin@example.com backup.db
```

### Network Security

**Firewall rules:**
```bash
# Allow only local access
sudo ufw allow from 127.0.0.1 to any port 8112

# Allow from specific IP
sudo ufw allow from 192.168.1.0/24 to any port 8112
```

**Reverse proxy (HTTPS):**
See [INSTALLATION.md](./INSTALLATION.md#reverse-proxy-setup)

## Maintenance Schedule

**Daily:**
- Check disk space
- Review error logs
- Verify backups completed

**Weekly:**
- Review slow query log
- Check database growth trend
- Update Docker images (if new version available)

**Monthly:**
- Vacuum database
- Review and archive old incidents
- Update dependencies (npm, Docker base images)
- Test backup restore procedure

**Quarterly:**
- Security audit
- Performance review
- Capacity planning

## Support

- **Documentation:** [docs/](./docs/)
- **Issues:** https://github.com/seayniclabs/stdout/issues
- **Email:** support@seayniclabs.com
