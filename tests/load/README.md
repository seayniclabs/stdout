# StdOut Load Testing

Load tests for StdOut infrastructure monitoring platform using k6.

## Prerequisites

```bash
# Install k6
brew install k6  # macOS
# OR
curl https://github.com/grafana/k6/releases/download/v0.45.0/k6-v0.45.0-linux-amd64.tar.gz -L | tar xvz
```

## Tests

### 1. Monitor Load Test (`monitors-load.js`)
Simulates 1000 monitors with regular check intervals.

**What it tests:**
- Monitor creation throughput
- Database write performance
- Worker queue scaling
- Check execution latency

**Run:**
```bash
k6 run tests/load/monitors-load.js
```

**Expected results:**
- 95% of requests < 500ms
- Error rate < 1%
- 1000+ monitors created
- Check latency avg < 200ms

### 2. Incident Spike Test (`incidents-load.js`)
Simulates spike of 10K incidents hitting the system in <1 minute.

**What it tests:**
- Incident ingestion rate
- Database write locks under contention
- Deduplication logic
- Auto-fix queue performance

**Run:**
```bash
k6 run tests/load/incidents-load.js
```

**Expected results:**
- 95% of requests < 2s (during spike)
- Error rate < 5%
- 10K+ incidents created
- Deduplication working (some 409 responses expected)

## Configuration

Set environment variables to customize:

```bash
# Target URL (default: http://localhost:4321)
export STDOUT_URL=https://stdout.seaynicroute.com

# Run tests
k6 run tests/load/monitors-load.js
```

## Monitoring During Load Tests

1. **Grafana Dashboard**: http://localhost:3000
   - Monitor CPU, memory, disk I/O
   - Check worker queue depth
   - Watch database connection pool

2. **StdOut Dashboard**: http://localhost:4321/app
   - Watch monitor creation rate
   - Check incident list pagination
   - Verify auto-fix suggestions appear

3. **Database Metrics**:
   ```bash
   # SQLite WAL size (should stay < 10MB)
   ls -lh ~/Projects/stdout/data/stdout.db-wal
   
   # Active connections
   lsof -p $(pgrep -f "npm run dev") | grep stdout.db
   ```

## Interpreting Results

### Success Criteria
- ✅ All thresholds pass
- ✅ Error rate < configured max
- ✅ No database deadlocks in logs
- ✅ Worker queue doesn't grow unbounded

### Common Failures
- **Timeout errors**: Worker pool too small, increase concurrency
- **Database locked**: SQLite contention, consider connection pool tuning
- **Memory spike**: Check for memory leaks in check workers
- **Queue backup**: Workers can't keep up, scale horizontally

## Cleanup After Tests

```bash
# Reset test database (if using isolated test DB)
rm ~/Projects/stdout/data/stdout-test.db*

# OR delete load test data
sqlite3 ~/Projects/stdout/data/stdout.db "DELETE FROM monitors WHERE name LIKE 'Load Test%';"
sqlite3 ~/Projects/stdout/data/stdout.db "DELETE FROM incidents WHERE source = 'load-test';"
```
