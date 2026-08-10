# Troubleshooting Container Restart Loops

## Symptoms

Container repeatedly crashes and restarts every few seconds or minutes. Docker shows status as "Restarting" or container uptime keeps resetting to seconds.

## Common Causes

### 1. Application Crash on Startup

**Diagnosis:**
```bash
docker logs <container-name> --tail 100
```

Look for:
- Uncaught exceptions
- Missing environment variables
- Failed dependency connections
- Permission errors

**Resolution:**
```bash
# Check last exit code
docker inspect <container-name> --format='{{.State.ExitCode}}'

# Common exit codes:
# 1 = Application error
# 137 = OOMKilled (out of memory)
# 139 = Segmentation fault
# 143 = SIGTERM (graceful shutdown)
```

### 2. Missing Environment Variables

**Diagnosis:**
```bash
docker inspect <container-name> --format='{{range .Config.Env}}{{println .}}{{end}}'
```

**Resolution:**
- Check docker-compose.yml or run command for required env vars
- Add missing variables to .env file or compose file
- Restart container with proper configuration

### 3. Health Check Failures

**Diagnosis:**
```bash
docker inspect <container-name> --format='{{json .State.Health}}' | jq
```

**Resolution:**
```yaml
# Adjust health check in docker-compose.yml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s  # Increase for slow-starting apps
```

### 4. Port Conflicts

**Diagnosis:**
```bash
# Check what's using the port
sudo lsof -i :8080
netstat -tuln | grep 8080
```

**Resolution:**
- Change exposed port in docker-compose.yml
- Stop conflicting service
- Use different host port mapping

### 5. Volume Mount Issues

**Diagnosis:**
```bash
docker inspect <container-name> --format='{{range .Mounts}}{{println .Source}}{{end}}'
```

**Resolution:**
```bash
# Check permissions
ls -la /path/to/volume

# Fix permissions
sudo chown -R 1000:1000 /path/to/volume

# Or run container as root (not recommended)
docker run --user root ...
```

## Prevention

1. **Add proper health checks** to all containers
2. **Use restart policies wisely**:
   ```yaml
   restart: unless-stopped  # Not "always" for debugging
   ```
3. **Set resource limits** to prevent OOM:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 512M
       reservations:
         memory: 256M
   ```
4. **Log aggregation** - ship logs to central location
5. **Graceful shutdown** - handle SIGTERM properly

## Quick Fix Checklist

- [ ] Check logs: `docker logs <container>`
- [ ] Check exit code: `docker inspect --format='{{.State.ExitCode}}'`
- [ ] Verify env vars are set
- [ ] Check health check configuration
- [ ] Verify port availability
- [ ] Check volume permissions
- [ ] Review resource limits (memory/CPU)
- [ ] Test with `restart: "no"` to prevent loop during debugging

## Related Issues

- [OOMKilled Containers](./oom-killed.md)
- [Docker Compose Health Checks](./health-checks.md)
- [Volume Permission Errors](./volume-permissions.md)
