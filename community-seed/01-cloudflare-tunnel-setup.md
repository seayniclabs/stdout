---
title: "Cloudflare Tunnel Setup and Troubleshooting"
type: runbook
tags: cloudflare, tunnel, networking, dns, zero-trust
---

## Purpose

Expose self-hosted services to the internet without opening router ports. Cloudflare Tunnel creates an outbound-only connection from your server to Cloudflare's edge, so nothing is listening on your public IP.

## Prerequisites

- A domain managed by Cloudflare (free plan works)
- `cloudflared` installed on your server (`brew install cloudflared` on macOS, or use the Docker image)
- A reverse proxy (Nginx Proxy Manager, Caddy, Traefik) if you're routing multiple services through one tunnel

## Setup

### 1. Authenticate and Create the Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create homelab
```

This drops a credentials file at `~/.cloudflared/<tunnel-id>.json`. Don't lose it — you need it to run the tunnel.

### 2. Configure Ingress Rules

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /path/to/.cloudflared/<your-tunnel-id>.json

ingress:
  # Direct service routing
  - hostname: app.example.com
    service: http://localhost:8100

  # Wildcard catch-all through reverse proxy
  - hostname: "*.lab.example.com"
    service: http://localhost:80

  # Required — catch-all 404 for unmatched requests
  - service: http_status:404
```

The wildcard rule is the key pattern. Point `*.lab.example.com` at your reverse proxy (port 80), and let the proxy handle per-subdomain routing. This means you add new services in the proxy without touching the tunnel config.

### 3. DNS Records

For each hostname in your ingress rules, create a CNAME record in Cloudflare DNS:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | app | `<tunnel-id>.cfargotunnel.com` | Proxied (orange cloud) |
| CNAME | *.lab | `<tunnel-id>.cfargotunnel.com` | Proxied (orange cloud) |

Wildcard CNAMEs cover all subdomains, so you only set this once.

### 4. Run the Tunnel

```bash
cloudflared tunnel run homelab
```

For persistence, install it as a service:

```bash
sudo cloudflared service install
```

On macOS, this creates a launchd plist. On Linux, a systemd unit.

## Troubleshooting

### Tunnel connects but pages return 502

The tunnel is running, but `cloudflared` can't reach your service. Check:

1. Is the service actually listening? `curl -I http://localhost:<port>` from the same machine.
2. If using Docker, remember that `localhost` inside a container is not the host. Use `host.docker.internal:<port>` on macOS or the Docker bridge IP on Linux.
3. Check `cloudflared` logs: `journalctl -u cloudflared` (Linux) or `log show --predicate 'process == "cloudflared"'` (macOS).

### Infinite redirect loop (ERR_TOO_MANY_REDIRECTS)

This happens when Cloudflare's SSL mode conflicts with your reverse proxy:

- If your proxy forces SSL and Cloudflare also terminates SSL, you get a redirect loop.
- **Fix:** In your reverse proxy, turn off "Force SSL" for tunnel-routed domains. Cloudflare already handles HTTPS on the edge. The tunnel carries plain HTTP between Cloudflare and your server.
- In Cloudflare dashboard: SSL/TLS > set to "Full" (not "Full (strict)" unless your proxy has a valid cert).

### DNS not resolving after adding CNAME

Cloudflare DNS propagation is usually instant, but:

- Verify the record exists: `dig app.example.com +short` should return something like `<tunnel-id>.cfargotunnel.com`.
- If using a wildcard, `dig test.lab.example.com` should also resolve.
- Flush your local DNS cache: `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder` (macOS).

### Tunnel disconnects randomly

Check your machine's sleep settings. A Mac Mini used as a server should have:

```bash
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
```

Also verify `cloudflared` is running as a service, not in a terminal session that might close.

## Verification

After setup, confirm end-to-end connectivity:

```bash
# Tunnel status
cloudflared tunnel info homelab

# External access
curl -I https://app.example.com

# Check the tunnel is routing correctly
curl -v https://app.example.com 2>&1 | grep "< cf-"
```

You should see Cloudflare headers (`cf-ray`, `cf-cache-status`) in the response, confirming traffic is flowing through the tunnel.
