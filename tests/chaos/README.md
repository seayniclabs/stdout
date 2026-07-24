# StdOut Chaos Testing

Chaos engineering tests for infrastructure resilience testing.

## Tests

1. **kill-workers.sh** - Randomly terminates worker processes
2. **network-partition.sh** - Blocks network to external services  
3. **database-lock.sh** - Holds exclusive database write lock
4. **disk-full.sh** - Simulates disk space exhaustion

## Usage

See inline documentation in each script.

**Note**: These tests simulate production failures. Run against test environments only.

## Success Criteria

- System recovers without manual intervention
- UI remains functional during failures
- No data loss or corruption
- Incidents/alerts triggered appropriately
