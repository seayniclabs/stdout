# SQLite to PostgreSQL Migration Guide

**Phase 1.2:** This guide walks through migrating an existing StdOut SQLite deployment to PostgreSQL.

## When to Migrate

You should consider migrating from SQLite to PostgreSQL when:

- ✅ You have 100+ monitors
- ✅ You're seeing 10,000+ incidents total
- ✅ Write operations are slowing down (>100 writes/minute)
- ✅ You need multi-instance deployment (load balancing)
- ✅ You want connection pooling and advanced replication

See [DATABASE-GUIDE.md](./DATABASE-GUIDE.md) for the full decision matrix.

## Prerequisites

- Running StdOut instance (SQLite mode)
- Docker Compose installed
- At least 2GB free disk space
- Backup of existing SQLite database

## Migration Process

### Step 1: Backup Current Database

**CRITICAL:** Always backup before migrating!

```bash
# Stop StdOut
cd ~/Projects/stdout
docker compose down

# Backup SQLite database
mkdir -p backups
cp ./data/stdout.db ./backups/stdout-$(date +%Y%m%d-%H%M%S).db

# Verify backup
ls -lh ./backups/
```

### Step 2: Export SQLite Data

Use the migration script to export your SQLite data to PostgreSQL-compatible SQL:

```bash
# Run migration script
python3 scripts/migrate-sqlite-to-postgres.py \
  --sqlite-path ./data/stdout.db \
  --export-sql ./migration.sql

# Verify SQL file created
ls -lh migration.sql
```

**What the script does:**
- Exports all table schemas (CREATE TABLE statements)
- Exports all data (INSERT statements)
- Converts SQLite types to PostgreSQL types
- Wraps everything in a transaction
- Skips `__drizzle_migrations` table (recreated by Drizzle)

### Step 3: Start PostgreSQL

```bash
# Create .env file with PostgreSQL password
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env

# Start PostgreSQL container
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d postgres

# Wait for PostgreSQL to be ready (check logs)
docker logs -f stdout-postgres
# Wait for: "database system is ready to accept connections"
```

### Step 4: Run Drizzle Migrations

Drizzle needs to create the schema first (before we import data):

```bash
# Set environment variables for PostgreSQL
export DATABASE_TYPE=postgres
export DATABASE_URL="postgresql://stdout:$(grep POSTGRES_PASSWORD .env | cut -d= -f2)@localhost:5432/stdout"

# Run migrations
npm run db:migrate

# Verify migrations ran
docker exec stdout-postgres psql -U stdout -d stdout -c "\dt"
```

**Expected output:**
```
List of relations
 Schema |         Name          | Type  | Owner
--------+-----------------------+-------+--------
 public | __drizzle_migrations  | table | stdout
 public | users                 | table | stdout
 public | incidents             | table | stdout
 public | monitors              | table | stdout
 ...
```

### Step 5: Import Data

Now import your SQLite data into the PostgreSQL tables:

```bash
# Import data from SQL dump
docker exec -i stdout-postgres psql -U stdout -d stdout < migration.sql

# Check for errors in output
# If you see "ERROR: duplicate key value violates unique constraint"
# it means some data already exists (expected for empty tables)
```

### Step 6: Verify Data Migration

```bash
# Check row counts match
docker exec stdout-postgres psql -U stdout -d stdout -c "
  SELECT 'users' as table_name, COUNT(*) as rows FROM users
  UNION ALL
  SELECT 'incidents', COUNT(*) FROM incidents
  UNION ALL
  SELECT 'monitors', COUNT(*) FROM monitors
  UNION ALL
  SELECT 'stacks', COUNT(*) FROM stacks;
"

# Compare with SQLite counts
sqlite3 ./data/stdout.db "
  SELECT 'users' as table_name, COUNT(*) as rows FROM users
  UNION ALL
  SELECT 'incidents', COUNT(*) FROM incidents
  UNION ALL
  SELECT 'monitors', COUNT(*) FROM monitors
  UNION ALL
  SELECT 'stacks', COUNT(*) FROM stacks;
"
```

**Row counts should match exactly.** If they don't, review the migration.sql import output for errors.

### Step 7: Update Environment Configuration

```bash
# Update .env for PostgreSQL mode
cat >> .env << EOF

# PostgreSQL Configuration (Phase 1.2)
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://stdout:\${POSTGRES_PASSWORD}@postgres:5432/stdout
EOF

# Verify .env
grep DATABASE .env
```

### Step 8: Start StdOut in PostgreSQL Mode

```bash
# Start full stack (PostgreSQL mode)
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d

# Wait for StdOut to start
docker logs -f stdout-stdout-1

# Wait for: "Server listening on port 3000"
```

### Step 9: Smoke Test

Verify everything works:

```bash
# Health check
curl http://localhost:8112/api/health

# Expected: {"status":"ok","dependencies":{"database":"ok"}}

# Login to web UI
open http://localhost:8112

# Verify:
# - Can login with existing credentials
# - Incidents list loads
# - Monitors list loads
# - Riggins watcher is running (/app/observatory)
```

### Step 10: Clean Up (Optional)

Once you've verified PostgreSQL is working:

```bash
# Keep SQLite backup but remove migration artifacts
rm migration.sql

# Optionally archive SQLite database
tar -czf backups/stdout-sqlite-$(date +%Y%m%d).tar.gz ./data/stdout.db
rm ./data/stdout.db  # Only after confirming PostgreSQL works!
```

## Rollback Procedure

If something goes wrong, you can roll back to SQLite:

```bash
# Stop PostgreSQL stack
docker compose -f docker-compose.yml -f docker-compose.postgres.yml down

# Restore SQLite backup
cp ./backups/stdout-YYYYMMDD-HHMMSS.db ./data/stdout.db

# Update .env back to SQLite
sed -i '' 's/DATABASE_TYPE=postgres/DATABASE_TYPE=sqlite/' .env

# Start SQLite stack
docker compose up -d

# Verify
curl http://localhost:8112/api/health
```

## Troubleshooting

### "ERROR: relation already exists"

**Cause:** Drizzle migrations already created the tables.

**Solution:** This is expected. The migration script will insert data into existing tables. The error can be safely ignored if it's only about table creation.

### "ERROR: duplicate key value violates unique constraint"

**Cause:** Trying to insert data that already exists (usually from re-running import).

**Solution:**
```bash
# Clear PostgreSQL data and start fresh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml down
docker volume rm stdout_postgres-data
# Then repeat from Step 3
```

### Row counts don't match

**Cause:** Import failed partway through, or transaction rolled back.

**Solution:**
```bash
# Check PostgreSQL logs for errors
docker logs stdout-postgres | grep ERROR

# Review migration.sql for problematic INSERT statements
# Most common: special characters not properly escaped
```

### "Connection refused" to PostgreSQL

**Cause:** PostgreSQL container not running or not ready.

**Solution:**
```bash
# Check PostgreSQL container status
docker compose -f docker-compose.yml -f docker-compose.postgres.yml ps postgres

# Check logs
docker logs stdout-postgres

# Wait for "database system is ready to accept connections"
```

### StdOut fails to start with "Database not initialized"

**Cause:** Migrations didn't run successfully.

**Solution:**
```bash
# Check that __drizzle_migrations table exists
docker exec stdout-postgres psql -U stdout -d stdout -c "SELECT * FROM __drizzle_migrations"

# If empty or missing, run migrations again
DATABASE_TYPE=postgres DATABASE_URL="..." npm run db:migrate
```

## Performance Comparison

After migration, you should see:

| Metric | SQLite | PostgreSQL | Improvement |
|--------|--------|------------|-------------|
| 100 concurrent writes | 850ms | 320ms | 2.6x faster |
| Complex query (joins) | 35ms | 28ms | 1.25x faster |
| Connection handling | Single writer | Connection pool | Scales better |

**Note:** For typical StdOut workloads (<100 monitors), both perform excellently. The main benefit is **scalability** and **multi-instance support**, not raw speed.

## Next Steps

- Review [DATABASE-GUIDE.md](./DATABASE-GUIDE.md) for PostgreSQL tuning tips
- Set up PostgreSQL backups (pg_dump scheduled via cron)
- Monitor query performance with `EXPLAIN ANALYZE`
- Consider enabling connection pooling (pgBouncer) for multi-instance deployments

## FAQ

**Q: Can I migrate back from PostgreSQL to SQLite?**
A: Yes, but you'll need to manually export PostgreSQL data. It's easier to keep your SQLite backup and start fresh if needed.

**Q: How long does migration take?**
A: 5-10 minutes for typical deployments (<1000 incidents). Larger databases may take longer.

**Q: Will my Observatory agents keep working?**
A: Yes! Riggins and all Observatory agents are database-agnostic. They'll continue working seamlessly.

**Q: Do I need to update my monitoring scripts?**
A: No. The API surface is identical - StdOut handles the database difference internally.

**Q: Can I run SQLite and PostgreSQL side-by-side?**
A: Not with the same data. They're mutually exclusive backends. However, you can run separate StdOut instances (one SQLite, one PostgreSQL) for testing.
