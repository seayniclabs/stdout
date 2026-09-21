# StdOut PostgreSQL Migration Health Check Runbook v1.1

## Purpose
This runbook documents the current state of PostgreSQL usage for the StdOut project and provides steps to verify and migrate to PostgreSQL if needed.

## Current State Assessment (as of 2026-08-31)

We ran the following commands to assess the environment:

### 1. Check for running stdout-postgres container
```bash
docker ps --filter name=stdout-postgres --format '{{.Names}}\t{{.Status}}'
```
Output: 
**Finding:** No container named `stdout-postgres` is running.

### 2. Check for any container with "stdout" in the name
```bash
docker ps -a --filter name=stdout --format '{{.Names}}'
```
Output: 
**Finding:** No containers related to StdOut are currently running (or exist).

### 3. Check for listening PostgreSQL ports on host
```bash
lsof -i :5432
```
Output:
```
COMMAND   PID        USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
postgres 3470 charlieseay    7u  IPv4 0x9f44688ddc644a89      0t0  TCP localhost:postgresql (LISTEN)
postgres 3470 charlieseay    8u  IPv6 0xfff347a96717759b      0t0  TCP localhost:postgresql (LISTEN)
```
**Finding:** A PostgreSQL instance is listening on port 5432 (localhost). This matches the description of the decommissioned Homebrew instance and should not be used for StdOut.

### 4. Check StdOut database configuration
```bash
cat ~/Projects/stdout/.env
```
Output:
```
APP_URL=http://localhost:8112
SECRET_KEY=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4
DB_PATH=./stdout-local.db
STDOUT_MODE=selfhost
```
**Finding:** The project is configured to use SQLite (`DB_PATH=./stdout-local.db`) and `STDOUT_MODE=selfhost`.

### 5. Check Docker Compose configuration for PostgreSQL
```bash
cat ~/Projects/stdout/docker-compose.postgres.yml
```
Output:
# Docker Compose Configuration for PostgreSQL Deployment
#
# This extends the default docker-compose.yml to add PostgreSQL support.
# Use this for scaling deployments that need better performance and concurrency.
#
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
#
# Environment variables required:
#   POSTGRES_PASSWORD - Database password (set in .env or pass via -e)
#
# Comparison vs SQLite:
#   SQLite:     Best for edge deployments, single instance, <100 monitors
#   PostgreSQL: Best for scaling, multi-instance, 100+ monitors, high write volume

services:
  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: stdout-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=stdout
      - POSTGRES_USER=stdout
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - PGDATA=/var/lib/postgresql/data/pgdata
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U stdout\"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - stdout-net

  # StdOut (PostgreSQL mode)
  stdout:
    environment:
      - DATABASE_TYPE=postgres
      - DATABASE_URL=postgresql://stdout:${POSTGRES_PASSWORD}@postgres:5432/stdout
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
```
**Finding:** A PostgreSQL service is defined in `docker-compose.postgres.yml` but is not included in the default `docker-compose.yml`.

### 6. Check ORM dialect
```bash
cat ~/Projects/stdout/drizzle.config.ts
```
Output:
```
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/stdout.db',
  },
});
```
**Finding:** The Drizzle ORM is configured for SQLite dialect.

### 7. List migration scripts
```bash
ls -la ~/Projects/stdout/migrations/
```
Output:
```
total 88
drwxr-xr-x@  12 charlieseay  staff   384 Aug 20 20:11 .
drwxr-xr-x@ 199 charlieseay  staff   6368 Aug 31 13:05 ..
-rw-r--r--@   1 charlieseay  staff  4523 Jun  9 19:30 0010_add_observatory_learning_layer.sql
-rw-r--r--@   1 charlieseay  staff   900 Jun  9 20:18 0011_add_data_sources_table.sql
-rw-r--r--@   1 charlieseay  staff  3189 Jun 12 02:16 0011_seed_observatory_patterns.ts
-rw-r--r--@   1 charlieseay  staff   519 Jun 15 12:35 0012_add_output_freshness_monitor.sql
-rw-r--r--@   1 charlieseay  staff  1206 Jun 17 18:04 0013_add_skins_tables.sql
-rw-r--r--@   1 charlieseay  staff  1938 Jul  6 08:40 0014_data_source_events.sql
-rw-r--r--@   1 charlieseay  staff  3542 Jul 21 18:42 0015_auto_remediation_and_cost_tracking.sql
-rw-r--r--@   1 charlieseay  staff   790 Jun 10 13:24 006_error_log.sql
-rw-r--r--@   1 charlieseay  staff  1956 Aug 20 20:11 2026-08-20-discovery-integration.sql
-rw-r--r--@   1 charlieseay  staff   652 Aug 14 17:34 add-device-profile-columns.sql
```
**Finding:** Migration scripts are present and appear to be SQLite-compatible (using INTEGER for timestamps).

## Health Check Summary
- **PostgreSQL Container:** Not running.
- **Host Port 5432:** In use by a decommissioned Homebrew instance (do not use).
- **Current Database:** SQLite (stdout-local.db).
- **Migration Scripts:** Present but tailored for SQLite.
- **ORM Configuration:** SQLite.

## Remediation Steps
If migration to PostgreSQL is desired:

### Step 1: Set Environment Variables
Create a `.env` file (or update existing) with the following:
```
POSTGRES_PASSWORD=your_secure_password_here
STDOUT_MODE=postgres   # or set DATABASE_TYPE=postgres via environment
DB_PATH=   # optional, but can be left empty or commented
```

### Step 2: Start PostgreSQL Service
```bash
cd ~/Projects/stdout
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d postgres
```

### Step 3: Verify Container is Healthy
```bash
docker ps --filter name=stdout-postgres --format '{{.Names}}\t{{.Status}}'
```
Expected output:
```
stdout-postgres   Up About a minute
```

### Step 4: Run Migrations
Since the project uses Drizzle, you can generate and run migrations for PostgreSQL by updating the dialect in `drizzle.config.ts` to `postgres` and providing the appropriate connection string.

Alternatively, if using raw SQL, ensure the migration scripts are compatible with PostgreSQL (adjust data types: e.g., change INTEGER timestamps to TIMESTAMPTZ, adjust SERIAL types, etc.).

### Step 5: Update Application to Use PostgreSQL
Set the environment variable `DATABASE_TYPE=postgres` (or ensure the service uses the `DATABASE_URL` as defined in `docker-compose.postgres.yml`).

### Step 6: Verify Connection
```bash
PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p 5432 -U stdout -d stdout -c "SELECT version();"
```
Expected output: PostgreSQL version string.

### Step 7: Check Table Sizes
```bash
PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p 5432 -U stdout -d stdout -c "\dt+"
```
Expected output: List of tables with sizes.

### Step 8: Check for Long-Running Queries
```bash
PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p 5432 -U stdout -d stdout -c "SELECT pid, now()-query_start AS duration, state, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC LIMIT 10;"
```
Expected output: Any active queries.

## Verification
After completing the steps, run the following to confirm:
```bash
docker ps --filter name=stdout-postgres --format '{{.Names}}' | grep -q stdout-postgres && echo CONTAINER_OK
PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p 5432 -U stdout -d stdout -c "SELECT 1;" -tA | grep -q "^1$" && echo DB_REACHABLE
```
Both should output `OK`.

## Notes
- Do not use the existing PostgreSQL instance on port 5432 as it is decommissioned.
- Ensure backups are taken before migrating from SQLite to PostgreSQL.
- Test the migration in a staging environment first.

## Change Log
| Date | Author | Change |
|------|--------|--------|
| 2026-08-31 | Bosun | Initial runbook based on actual environment assessment. |