---
title: "Nginx Proxy Manager: Adding a New Service with SSL"
type: runbook
tags: nginx, proxy, ssl, reverse-proxy, docker
---

## Purpose

Route a new subdomain to a containerized service through Nginx Proxy Manager (NPM), with SSL termination handled either by NPM or an upstream provider like Cloudflare.

## Prerequisites

- NPM running and accessible (typically on ports 80/443 for proxy, 81 for the admin UI)
- A DNS record pointing your subdomain to NPM (either directly or via a Cloudflare Tunnel)
- The target service running and reachable from the NPM container

## Procedure

### 1. Verify the Service is Reachable

Before touching NPM, confirm the service responds from the host:

```bash
curl -I http://localhost:<service-port>
```

If the service is in a Docker container on macOS, NPM (also in Docker) needs to reach it via `host.docker.internal:<port>`, not `localhost`. This is the single most common source of "502 Bad Gateway" in a Mac-based lab.

On Linux, use the Docker bridge IP (usually `172.17.0.1`) or put both containers on the same Docker network.

### 2. Create the Proxy Host

1. Open NPM admin UI at `http://<server-ip>:81`
2. Go to **Hosts > Proxy Hosts > Add Proxy Host**
3. Fill in:

| Field | Value |
|-------|-------|
| Domain Names | `service.lab.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | `host.docker.internal` (macOS) or container name (same network) |
| Forward Port | The service's internal port |
| Block Common Exploits | On |
| Websockets Support | On (if the app uses WebSockets — n8n, Grafana, etc.) |

### 3. SSL Configuration

This depends on your setup:

**Option A: Cloudflare handles SSL (recommended with tunnels)**

- SSL tab in NPM: select "None" or use a Cloudflare Origin Certificate
- **Do not enable "Force SSL"** — Cloudflare terminates SSL at the edge and forwards HTTP through the tunnel. Forcing SSL creates a redirect loop.
- In Cloudflare: SSL/TLS mode set to "Full"

**Option B: NPM handles SSL with Let's Encrypt**

- SSL tab: Request a new Let's Encrypt certificate
- Check "Force SSL" and "HTTP/2 Support"
- Requires ports 80/443 to be publicly reachable for the ACME challenge
- Not compatible with Cloudflare Tunnel (the tunnel doesn't expose port 80 for challenges)

### 4. Forward Auth (Optional — for SSO)

If you run an identity provider (Authentik, Authelia, etc.), add forward auth:

1. In the proxy host, go to the **Advanced** tab
2. Add the forward auth snippet. For Authentik:

```nginx
location / {
    auth_request     /outpost.goauthentik.io/auth/nginx;
    error_page       401 = @goauthentik_proxy_signin;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header       Set-Cookie $auth_cookie;

    proxy_pass       http://host.docker.internal:<port>;
    proxy_set_header Host $http_host;
}
```

**Critical:** The `proxy_set_header Host $http_host` line must be present. Without it, the SSO provider can't construct the correct redirect URL after authentication, and you'll get redirect loops or land on the wrong page.

### 5. Test the Route

```bash
# Should return 200 (or 302 if behind auth)
curl -I https://service.lab.example.com

# Check NPM logs for errors
docker logs nginx-proxy-manager --tail 50
```

### 6. Reload if Needed

NPM usually picks up changes automatically, but if routing seems stale:

```bash
docker exec nginx-proxy-manager nginx -s reload
```

## Common Issues

**502 Bad Gateway** — NPM can't reach the backend. Check: is the forward hostname correct? Is the service actually running? Is the port right? On macOS, is it `host.docker.internal`?

**504 Gateway Timeout** — The service is reachable but slow to respond. Increase proxy timeout in the Advanced tab:

```nginx
proxy_read_timeout 300;
proxy_connect_timeout 300;
proxy_send_timeout 300;
```

**Mixed content warnings** — Your app thinks it's running on HTTP but the browser loaded HTTPS. Set the `X-Forwarded-Proto` header in NPM's advanced config, and configure your app to trust the proxy.

## Verification Checklist

- [ ] Service responds locally: `curl http://localhost:<port>`
- [ ] NPM proxy host created with correct forward hostname and port
- [ ] SSL configured (Cloudflare or Let's Encrypt, not both)
- [ ] External URL loads in browser without errors
- [ ] If using auth, login flow completes and returns to the correct page
