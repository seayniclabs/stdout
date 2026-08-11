# Kubernetes Service Discovery and DNS Issues

## Overview
Service discovery failures prevent pods from communicating with each other or external services.

## Common Symptoms
- `nslookup: can't resolve '<service-name>'`
- `dial tcp: lookup <service-name> on 10.96.0.10:53: no such host`
- Connection timeouts despite service existing
- Intermittent connectivity issues

## DNS Resolution in Kubernetes

### Default DNS Names
```
<service-name>                          # Same namespace
<service-name>.<namespace>              # Cross-namespace (short)
<service-name>.<namespace>.svc.cluster.local  # Fully qualified
```

### CoreDNS Pods
```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
```

## Diagnostic Steps

### 1. Verify Service Exists
```bash
kubectl get svc -n <namespace>
kubectl describe svc <service-name> -n <namespace>
```

Check:
- Service has endpoints (actual pods selected)
- Port configurations match deployment

### 2. Test DNS Resolution
From inside a pod:
```bash
kubectl exec -it <pod-name> -- nslookup <service-name>
kubectl exec -it <pod-name> -- nslookup <service-name>.<namespace>.svc.cluster.local
```

### 3. Check Service Endpoints
```bash
kubectl get endpoints <service-name> -n <namespace>
```

If endpoints list is empty:
- Check pod labels match service selector
- Verify pods are in Running state
- Check readiness probe status

### 4. Verify Network Policies
```bash
kubectl get networkpolicies -n <namespace>
kubectl describe networkpolicy <policy-name> -n <namespace>
```

Network policies can block traffic between pods.

### 5. Test Direct Pod IP Connection
```bash
# Get pod IP
kubectl get pod <pod-name> -o wide

# Test connection from another pod
kubectl exec -it <client-pod> -- curl http://<pod-ip>:<port>
```

If direct IP works but service DNS doesn't → DNS issue.
If direct IP fails → network policy or pod issue.

## Common Fixes

### Service Selector Mismatch
```yaml
# Service must match deployment labels
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app  # Must match deployment pod labels
  ports:
  - port: 80
    targetPort: 8080
```

### CoreDNS Issues
Restart CoreDNS pods:
```bash
kubectl rollout restart deployment/coredns -n kube-system
```

Check CoreDNS ConfigMap:
```bash
kubectl get configmap coredns -n kube-system -o yaml
```

### DNS Policy Override
In pod spec:
```yaml
dnsPolicy: ClusterFirst  # Default - use cluster DNS
# Or:
dnsPolicy: Default  # Use node's DNS resolver
```

### NetworkPolicy Blocking Traffic
Allow traffic to service:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-app-traffic
spec:
  podSelector:
    matchLabels:
      app: my-app
  ingress:
  - from:
    - podSelector: {}  # Allow from all pods in namespace
    ports:
    - protocol: TCP
      port: 8080
```

## Headless Services
For direct pod-to-pod communication:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app-headless
spec:
  clusterIP: None  # Headless service
  selector:
    app: my-app
  ports:
  - port: 8080
```

DNS returns pod IPs instead of service IP:
```bash
nslookup my-app-headless
# Returns: 10.244.1.5, 10.244.2.8, 10.244.3.12
```

## External Service Access

### ExternalName Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-database
spec:
  type: ExternalName
  externalName: db.example.com
```

Pods can use `external-database` DNS name to reach external host.

### Service with External IPs
```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-api
spec:
  type: ClusterIP
  externalIPs:
  - 192.168.1.100
  ports:
  - port: 443
```

## Prevention

1. **Use fully qualified domain names** in production
2. **Set up network policies early** - Don't add them after deployment
3. **Monitor CoreDNS health** - Set up alerts for CoreDNS pod crashes
4. **Use readiness probes** - Pods only get endpoints when ready
5. **Document service dependencies** - Track what talks to what
