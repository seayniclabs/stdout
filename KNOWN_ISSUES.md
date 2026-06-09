# StdOut Known Issues

## Custom Domain Setup During Installation

**Issue**: Using a custom domain (e.g., `stdout.seaynicroute.com`) during installation causes "Forbidden - origin not allowed" errors when accessed through Nginx Proxy Manager / Cloudflare.

**Symptoms**:
- Browser shows "Forbidden - origin not allowed"
- Direct container access works fine (`http://localhost:8112` or `http://IP:8112`)
- No requests reach the StdOut container logs when accessing via domain
- curl to domain succeeds, but browser requests fail

**Root Cause**:
- Nginx Proxy Manager or Cloudflare is blocking the requests before they reach the container
- Likely a CORS/origin policy at the proxy/CDN layer
- Not an issue with StdOut's middleware (verified with logs)

**Workaround**:
Use direct IP access during installation:
```
http://192.168.0.244:8112
```

After setup completes, configure the proxy properly.

**Proper Fix Required**:
1. Document Nginx Proxy Manager configuration for StdOut
2. Add Cloudflare Access bypass rules for /setup paths
3. Update installation docs to recommend IP-first setup
4. Provide post-install domain migration guide

**Priority**: Medium (workaround exists, but affects initial UX)

**Discovered**: 2026-06-09 during automated setup testing

**Affected Versions**: v1.2.1+

---

## Workaround Steps

1. **Initial Setup**: Use `http://192.168.0.244:8112`
2. **Complete Setup**: Create account, name environment, verify automation
3. **Post-Setup**: Configure NPM proxy host settings:
   - Enable WebSockets
   - Add custom headers if needed
   - Verify origin/CORS settings
4. **Update APP_URL**: 
   ```bash
   # Update .env
   APP_URL=https://stdout.seaynicroute.com
   
   # Rebuild with new URL
   docker compose build --build-arg APP_URL=https://stdout.seaynicroute.com
   docker compose up -d --force-recreate
   ```
5. **Test domain access**

---

## Related

- [ ] Create NPM configuration guide
- [ ] Add Cloudflare setup documentation
- [ ] Test setup wizard with various proxy configurations
- [ ] Consider adding setup bypass token for proxy environments
