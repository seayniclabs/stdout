# Database Slow Query Diagnosis and Optimization

## Overview
Slow queries are the #1 cause of database performance issues. This guide covers identification, analysis, and optimization.

## PostgreSQL Slow Query Analysis

### Enable Slow Query Logging
```sql
-- postgresql.conf
log_min_duration_statement = 1000  -- Log queries taking >1s
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
```

### Find Slow Queries
```sql
-- pg_stat_statements extension (install first)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 slowest queries by total time
SELECT 
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Queries with highest average time
SELECT 
  query,
  calls,
  mean_exec_time,
  stddev_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Analyze Query Plan
```sql
EXPLAIN ANALYZE
SELECT * FROM orders 
WHERE customer_id = 12345 
  AND created_at > '2024-01-01';
```

Look for:
- **Seq Scan** on large tables (missing index)
- High **cost** estimates
- **Nested Loop** with many rows
- **Sort** operations on large datasets

### Common Slow Query Patterns

#### 1. Missing Index
```sql
-- Problem: Full table scan
SELECT * FROM orders WHERE customer_id = 123;

-- Solution: Add index
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
```

#### 2. Non-Selective Index
```sql
-- Problem: Index not used because column has low cardinality
SELECT * FROM users WHERE is_active = true;  -- 99% of users are active

-- Solution: Partial index
CREATE INDEX idx_active_users ON users(created_at) 
WHERE is_active = true;
```

#### 3. OR Conditions
```sql
-- Problem: Can't use indexes efficiently
SELECT * FROM products 
WHERE category_id = 5 OR manufacturer_id = 10;

-- Solution: UNION
SELECT * FROM products WHERE category_id = 5
UNION
SELECT * FROM products WHERE manufacturer_id = 10;
```

#### 4. Function on Indexed Column
```sql
-- Problem: Index not used
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- Solution: Function-based index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
```

#### 5. SELECT * with Large BLOB/TEXT
```sql
-- Problem: Fetching large columns you don't need
SELECT * FROM documents WHERE user_id = 123;

-- Solution: Select only needed columns
SELECT id, title, created_at FROM documents WHERE user_id = 123;
```

## MySQL/MariaDB Slow Query Analysis

### Enable Slow Query Log
```ini
# my.cnf
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow-query.log
long_query_time = 1
log_queries_not_using_indexes = 1
```

### Analyze Slow Query Log
```bash
# Install pt-query-digest (Percona Toolkit)
pt-query-digest /var/log/mysql/slow-query.log
```

### Find Queries Not Using Indexes
```sql
SELECT * FROM information_schema.PROCESSLIST 
WHERE command != 'Sleep' 
  AND time > 5
ORDER BY time DESC;
```

### Query Plan Analysis
```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 123;
```

Look for:
- `type: ALL` (full table scan - bad)
- `type: index` (index scan - acceptable)
- `type: ref` or `type: eq_ref` (index lookup - good)

## SQLite Slow Query Analysis

### Enable Query Profiling
```sql
.timer on
.eqp on  -- Show query plan
```

### Analyze Query Plan
```sql
EXPLAIN QUERY PLAN
SELECT * FROM orders WHERE customer_id = 123;
```

### Create Indexes
```sql
CREATE INDEX idx_orders_customer_id ON orders(customer_id);

-- Composite index for multiple columns
CREATE INDEX idx_orders_customer_date 
ON orders(customer_id, created_at);
```

### Vacuum Database
```sql
VACUUM;  -- Rebuild database file
ANALYZE;  -- Update query planner statistics
```

## General Optimization Strategies

### 1. Index Strategy
```sql
-- Composite index column order matters
-- Put most selective column first
CREATE INDEX idx_orders_lookup 
ON orders(status, customer_id, created_at);

-- Use INCLUDE for covering indexes (PostgreSQL)
CREATE INDEX idx_orders_covering 
ON orders(customer_id) 
INCLUDE (total_amount, created_at);
```

### 2. Query Rewriting
```sql
-- Instead of NOT IN (slow)
SELECT * FROM orders WHERE customer_id NOT IN (
  SELECT id FROM banned_customers
);

-- Use LEFT JOIN with NULL check
SELECT o.* FROM orders o
LEFT JOIN banned_customers b ON o.customer_id = b.id
WHERE b.id IS NULL;
```

### 3. Pagination
```sql
-- Don't use OFFSET for large datasets
SELECT * FROM orders ORDER BY id LIMIT 100 OFFSET 10000;  -- Slow

-- Use keyset pagination
SELECT * FROM orders 
WHERE id > 10000  -- Last seen ID
ORDER BY id 
LIMIT 100;
```

### 4. Batch Operations
```sql
-- Instead of many single inserts
INSERT INTO logs (user_id, action) VALUES (1, 'login');
INSERT INTO logs (user_id, action) VALUES (2, 'login');

-- Batch insert
INSERT INTO logs (user_id, action) VALUES 
(1, 'login'),
(2, 'login'),
(3, 'logout');
```

## Connection Pool Tuning

### PostgreSQL
```
max_connections = 100
shared_buffers = 256MB  -- 25% of RAM
effective_cache_size = 1GB  -- 50-75% of RAM
work_mem = 10MB  -- Per query sort/hash operation
```

### Application Connection Pool
```python
# SQLAlchemy example
engine = create_engine(
    'postgresql://user:pass@localhost/db',
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600
)
```

## Monitoring Queries in Production

### PostgreSQL
```sql
-- Active queries
SELECT pid, usename, state, query, now() - query_start AS duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;

-- Kill long-running query
SELECT pg_terminate_backend(12345);  -- Replace with actual PID
```

### MySQL
```sql
-- Active queries
SHOW FULL PROCESSLIST;

-- Kill query
KILL 12345;
```

## Prevention Checklist

- [ ] Enable slow query logging
- [ ] Set up pg_stat_statements (PostgreSQL)
- [ ] Index all foreign keys
- [ ] Create indexes for WHERE/JOIN/ORDER BY columns
- [ ] Use EXPLAIN on all complex queries before deployment
- [ ] Monitor query performance in production
- [ ] Set up alerts for queries >5 seconds
- [ ] Review query plans monthly
- [ ] Keep database statistics up to date (ANALYZE)
- [ ] Regular VACUUM (PostgreSQL) or OPTIMIZE TABLE (MySQL)
