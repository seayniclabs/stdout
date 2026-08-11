# Kubernetes Pod CrashLoopBackOff Troubleshooting

## Overview
CrashLoopBackOff indicates a pod is repeatedly crashing and Kubernetes is backing off on restart attempts.

## Common Causes

### 1. Application Error
- Application exits immediately due to runtime errors
- Missing required environment variables
- Configuration file errors

### 2. Resource Limits
- Container runs out of memory (OOMKilled)
- CPU throttling causing timeouts
- Disk space exhausted

### 3. Dependency Issues
- Database connection failures
- Missing secrets or ConfigMaps
- Network policies blocking traffic

## Diagnostic Steps

### Check Pod Status
```bash
kubectl get pods -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

Look for:
- Exit codes (0=normal, 1=error, 137=OOMKilled)
- Restart count
- Last state reason

### View Logs
```bash
# Current logs
kubectl logs <pod-name> -n <namespace>

# Previous container logs
kubectl logs <pod-name> -n <namespace> --previous
```

### Check Events
```bash
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

### Resource Usage
```bash
kubectl top pod <pod-name> -n <namespace>
kubectl describe node <node-name>
```

## Common Fixes

### OOMKilled (Exit Code 137)
Increase memory limits in deployment:
```yaml
resources:
  requests:
    memory: "256Mi"
  limits:
    memory: "512Mi"
```

### Missing Environment Variables
Check pod environment:
```bash
kubectl exec -it <pod-name> -- env
```

Verify ConfigMaps and Secrets are mounted correctly.

### Liveness Probe Failures
Adjust probe timing:
```yaml
livenessProbe:
  initialDelaySeconds: 60  # Increase if app needs more startup time
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Database Connection Issues
1. Verify service DNS resolves:
```bash
kubectl exec -it <pod-name> -- nslookup <service-name>
```

2. Check network policies:
```bash
kubectl get networkpolicies -n <namespace>
```

3. Test connection from pod:
```bash
kubectl exec -it <pod-name> -- nc -zv <service-name> <port>
```

## Prevention

1. **Set appropriate resource limits** - Don't set memory limits too low
2. **Use readiness probes** - Prevent traffic before app is ready
3. **Configure liveness probes carefully** - Don't fail pods during normal startup
4. **Use init containers** - For dependency checks before main container starts
5. **Monitor resource usage** - Set up alerts for high memory/CPU
6. **Implement graceful shutdown** - Handle SIGTERM properly

## Related Issues
- ImagePullBackOff (wrong image or registry auth issues)
- Pending (scheduling issues, no resources available)
- Error (configuration errors preventing container start)
