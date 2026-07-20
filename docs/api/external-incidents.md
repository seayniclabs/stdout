# External Incidents API

StdOut's External Incidents API allows health monitoring tools to create incidents programmatically.

## Authentication

Set `STDOUT_HEALTH_TOKEN` environment variable to a secret token. Pass it as Bearer token:

```bash
curl -X POST http://your-stdout-instance/app/api/incidents/external \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d @incident.json
```

**Security:** Use a strong random token (32+ characters). Store it securely in your monitoring tool's environment.

## Endpoint

```
POST /app/api/incidents/external
```

## Request Schema

```json
{
  "title": "Service health check failed",
  "description": "Detailed description with remediation steps",
  "severity": "high",  // critical | high | medium | low
  "source": "your-monitor-name",
  "metadata": {
    // Any additional context (optional)
    "check": "docker-health",
    "host": "server-01",
    "timestamp": "2026-07-17T19:00:00Z"
  }
}
```

### Fields

- **title** (required): Short summary of the issue (max 200 chars)
- **description** (required): Detailed description with context and remediation steps
- **severity** (optional): `critical`, `high`, `medium`, or `low` (default: `high`)
- **source** (optional): Name of the monitoring tool creating the incident (default: `health-monitor`)
- **metadata** (optional): Additional structured data for context

## Response

### Success (201 Created)

```json
{
  "success": true,
  "incidentId": "abc123xyz",
  "message": "Incident created successfully",
  "url": "/app/incidents/abc123xyz"
}
```

### Error Responses

**401 Unauthorized**
```json
{
  "error": "Unauthorized",
  "hint": "Set STDOUT_HEALTH_TOKEN env var to match your health monitor configuration"
}
```

**400 Bad Request**
```json
{
  "error": "Missing required fields",
  "required": ["title", "description"]
}
```

**503 Service Unavailable**
```json
{
  "error": "No user found - setup wizard not complete"
}
```

## Example: Bosun Health Monitor

```bash
#!/bin/bash
# Set token in environment
export STDOUT_HEALTH_TOKEN="your-secret-token"

# Create incident using jq for proper JSON escaping
jq -n \
  --arg title "Docker service unhealthy" \
  --arg desc "Container xyz failed health check. Remediation: docker restart xyz" \
  --arg check "docker-health" \
  --arg details "Container xyz status: Unhealthy" \
  '{
    title: $title,
    description: $desc,
    severity: "high",
    source: "bosun-health-monitor",
    metadata: {
      check: $check,
      details: $details,
      timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
    }
  }' | \
curl -X POST http://localhost:8112/app/api/incidents/external \
  -H "Authorization: Bearer $STDOUT_HEALTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d @-
```

## Observatory Integration

Incidents created via this API are automatically:

1. **Picked up by Observatory Watcher** (runs every 3 minutes)
2. **Diagnosed by Reflex arc** using local LLM (ollama with qwen2.5:14b)
3. **Auto-remediated** (if mode=autofix and fix passes gating checks)

### Tagging

Incidents are automatically tagged with:
- `health-monitor` - Marks this as an external health check
- `{source}` - Your monitoring tool name
- `observatory` - Signals Observatory to process this incident

### Operating Modes

Observatory operates in three modes:

- **discover**: Analyzes incidents, suggests fixes (no execution)
- **diagnose**: Runs diagnosis, generates remediation plans
- **autofix**: Automatically applies gated-safe fixes

Check current mode at: `GET /app/api/observatory/health`

## Integration Examples

### Docker Health Checks

```bash
# Check container health
if docker ps --filter "health=unhealthy" --format "{{.Names}}" | grep -q .; then
  unhealthy=$(docker ps --filter "health=unhealthy" --format "{{.Names}}" | tr '\n' ', ')
  
  jq -n --arg unhealthy "$unhealthy" '{
    title: "Unhealthy Docker containers detected",
    description: ("Containers: " + $unhealthy + "\n\nRemediation: docker restart <container>"),
    severity: "critical",
    source: "docker-monitor"
  }' | curl -X POST "$STDOUT_API/app/api/incidents/external" \
    -H "Authorization: Bearer $STDOUT_HEALTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
fi
```

### Service Availability

```bash
# Check if service responds
if ! curl -sf "http://localhost:5678/health" >/dev/null; then
  jq -n '{
    title: "n8n service unreachable",
    description: "Service not responding on port 5678. Check: docker logs n8n",
    severity: "high",
    source: "service-monitor"
  }' | curl -X POST "$STDOUT_API/app/api/incidents/external" \
    -H "Authorization: Bearer $STDOUT_HEALTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
fi
```

### Disk Space

```bash
# Check disk usage
usage=$(df -H /data | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$usage" -gt 80 ]; then
  jq -n --arg usage "$usage" '{
    title: "Disk space critical",
    description: ("/data at " + $usage + "% (threshold: 80%)\n\nRemediation: Clean up old files or expand volume"),
    severity: "critical",
    source: "disk-monitor"
  }' | curl -X POST "$STDOUT_API/app/api/incidents/external" \
    -H "Authorization: Bearer $STDOUT_HEALTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
fi
```

## Best Practices

1. **Use jq for JSON construction** - Properly escapes special characters and prevents malformed JSON
2. **Include remediation steps** - Help Observatory (and humans) understand how to fix the issue
3. **Set appropriate severity** - Critical for service outages, high for degraded performance, medium/low for warnings
4. **Add context in metadata** - Include timestamps, affected hosts, check names for better diagnosis
5. **Use descriptive source names** - Makes it easy to identify which monitor created the incident
6. **Rotate tokens regularly** - Update STDOUT_HEALTH_TOKEN periodically for security

## Monitoring Observatory Health

Check if Observatory is processing incidents:

```bash
curl -s http://your-stdout-instance/app/api/observatory/health
```

Response:
```json
{
  "watcher": {
    "last_run": "2026-07-17T19:30:00Z",
    "age_seconds": 45,
    "running": true
  },
  "mode": "diagnose",
  "incidents": {
    "pending": 2,
    "diagnosed": 1,
    "pending_ids": ["abc", "xyz"]
  },
  "health": {
    "ok": true,
    "issues": []
  }
}
```

## Support

- Report issues: https://github.com/seayniclabs/stdout/issues
- Documentation: https://stdout.seayniclabs.com/docs
- Community: https://stdout.seayniclabs.com/community
