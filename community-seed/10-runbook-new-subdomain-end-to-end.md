---
title: "Runbook: Adding a New Subdomain End-to-End"
type: runbook
tags: dns, cloudflare, nginx, proxy, docker, subdomain, deployment
---

## Purpose

Step-by-step procedure for exposing a new self-hosted service at `service.lab.example.com`. Covers the full chain: DNS record, Cloudflare Tunnel ingress, Nginx Proxy Manager routing, SSL, and verification.

## Prerequisites

- Service running in a Docker container with a known port
- Cloudflare managing your domain's DNS
- Cloudflare Tunnel running and connected
- Nginx Proxy Manager running as a reverse proxy
- (Optional) Authentik or another SSO provider for access control

## Procedure

### Step 1: Verify the Service is Running

```bash
# Check the container is healthy
docker ps --filter "name=myservice" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Confirm it responds locally
curl -I http://localhost:<port>
```

If this doesn't return a response, fix the service first. Don't proceed with DNS/proxy setup until the app works locally.

### Step 2: Add DNS Record in Cloudflare

If your Cloudflare Tunnel uses a wildcard ingress rule (`*.lab.example.com → localhost:80`), and NPM is on port 80, you only need a DNS CNAME:

1. Cloudflare Dashboard > DNS > Records > Add Record
2. Type: **CNAME**
3. Name: `myservice` (or `myservice.lab` if using a subdomain prefix)
4. Target: `<tunnel-id>.cfargotunnel.com`
5. Proxy status: **Proxied** (orange cloud on)
6. TTL: Auto

**If your tunnel does NOT use a wildcard**, you also need to add an ingress rule — see Step 3.

### Step 3: Update Tunnel Ingress (If No Wildcard)

Edit `~/.cloudflared/config.yml`:

```yaml
ingress:
  # Add ABOVE the catch-all rule
  - hostname: myservice.lab.example.com
    service: http://localhost:<port>

  # Existing catch-all (always last)
  - service: http_status:404
```

Restart the tunnel:

```bash
# If running as a service
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared

# Or if running manually
cloudflared tunnel run homelab
```

**If you're using a wildcard rule that points to NPM**, skip this step entirely. The tunnel already forwards all subdomains to NPM, and NPM handles per-service routing.

### Step 4: Create NPM Proxy Host

1. NPM Admin UI (`http://<server>:81`) > Hosts > Proxy Hosts > Add
2. Configure:

| Field | Value |
|-------|-------|
| Domain Names | `myservice.lab.example.com` |
| Scheme | `http` |
| Forward Hostname | `host.docker.internal` (macOS) |
| Forward Port | `<service-port>` |
| Block Common Exploits | On |
| Websockets Support | On (if needed) |

3. SSL tab:
   - If behind Cloudflare Tunnel: **None** or Cloudflare Origin Certificate
   - **Do NOT enable Force SSL** (Cloudflare terminates TLS; forcing it causes redirect loops)

4. Save

### Step 5: Add Forward Auth (If Protected)

If the service should be behind SSO, edit the proxy host > Advanced tab and add your auth provider's nginx snippet. See the Authentik OIDC guide in this Knowledge Base for the exact config.

Services to typically leave **without** auth:
- Public-facing sites
- Webhook endpoints (GitHub, Stripe callbacks)
- Status pages
- The auth provider itself

### Step 6: Verify DNS Resolution

```bash
# Should return the tunnel CNAME
dig myservice.lab.example.com +short

# Should resolve to Cloudflare IPs
dig myservice.lab.example.com A +short
```

If empty, wait 1-2 minutes. Cloudflare DNS is usually instant but not always.

### Step 7: Verify End-to-End Access

```bash
# From outside your network (or use a phone on cellular)
curl -I https://myservice.lab.example.com
```

Expected results:
- **200** — service is accessible, no auth
- **302 to auth provider** — SSO is working, redirecting to login
- **502** — NPM can't reach the backend (check forward hostname/port)
- **521** — Cloudflare can't reach the tunnel (is `cloudflared` running?)
- **DNS error** — CNAME not set or not propagated yet

### Step 8: Add to Dashboard (Optional)

If you use Homepage or a similar dashboard, add the service entry:

```yaml
- My Service:
    icon: myservice.svg
    href: https://myservice.lab.example.com
    description: What this service does
    server: my-docker
    container: myservice
    widget:
      type: customapi  # or the specific widget type
      url: http://host.docker.internal:<port>/api/health
```

### Step 9: Add to Monitoring

Add an HTTP check to your monitoring system (Telegraf, Uptime Kuma, StdOut HUD) so you'll know if the service goes down:

- URL: `https://myservice.lab.example.com`
- Expected status: 200 (or 302 if behind auth)
- Interval: 60s
- Timeout: 10s

### Step 10: Update Health Check Script

If you run a container health check script, add the new container to the expected containers list and HTTP checks array so it gets auto-restarted and monitored.

## Rollback

If something goes wrong:

1. **DNS not working:** Delete the CNAME record in Cloudflare. Propagation is instant for deletes.
2. **Proxy misconfigured:** Delete the proxy host in NPM, or disable it.
3. **Tunnel ingress wrong:** Remove the hostname entry from `config.yml` and restart `cloudflared`.
4. **Service itself broken:** `docker stop myservice` — the rest of the chain will return 502, which is expected.

## Checklist Summary

- [ ] Service responds locally on its port
- [ ] CNAME record added in Cloudflare (proxied)
- [ ] Tunnel ingress rule added (if not using wildcard)
- [ ] NPM proxy host created (correct forward hostname and port)
- [ ] SSL configured correctly (no Force SSL with Cloudflare Tunnel)
- [ ] Forward auth added (if service needs SSO protection)
- [ ] DNS resolves from external network
- [ ] HTTPS URL loads in browser
- [ ] Dashboard entry added
- [ ] Monitoring check added
- [ ] Health check script updated
