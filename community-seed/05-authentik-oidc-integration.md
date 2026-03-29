---
title: "Authentik OIDC Integration for Self-Hosted Apps"
type: guide
tags: authentik, oidc, sso, authentication, security
---

## Purpose

Centralize authentication for your self-hosted services using Authentik as an OpenID Connect (OIDC) provider. Instead of managing separate logins for every app, users authenticate once through Authentik and get access to everything.

## Architecture

```
Browser → Cloudflare → Reverse Proxy (NPM) → Authentik outpost → Backend app
                                                    ↓
                                              Authentik server
                                            (identity provider)
```

There are two integration patterns: **forward auth** (proxy handles auth, app is unaware) and **native OIDC** (app speaks OIDC directly). Use forward auth when the app doesn't support OIDC. Use native OIDC when it does — it's cleaner and gives the app user identity.

## Forward Auth Setup (Proxy-Level)

This protects any app without modifying the app itself. Authentik's embedded outpost intercepts requests at the reverse proxy layer.

### 1. Create a Provider in Authentik

1. Admin interface > Applications > Providers > Create
2. Type: **Proxy Provider**
3. Name: `forward-auth-lab`
4. Authorization flow: `default-provider-authorization-implicit-consent`
5. Forward auth mode: **Single application** or **Domain-level** (domain-level covers all subdomains)
6. External host: `https://auth.lab.example.com`

### 2. Create an Application

1. Applications > Create
2. Name: `Lab Forward Auth`
3. Slug: `lab-forward-auth`
4. Provider: select the proxy provider you just created
5. Launch URL: leave blank for forward auth

### 3. Create an Outpost

1. Applications > Outposts > Create (or use the embedded outpost)
2. Type: Proxy
3. Select the application
4. Integration: Local Docker connection or embedded

### 4. Configure NPM

In each proxy host's Advanced tab, add the forward auth snippet:

```nginx
location /outpost.goauthentik.io {
    proxy_pass          http://host.docker.internal:9010/outpost.goauthentik.io;
    proxy_set_header    Host $http_host;
    proxy_set_header    X-Original-URL $scheme://$http_host$request_uri;
}

location / {
    auth_request     /outpost.goauthentik.io/auth/nginx;
    error_page       401 = @goauthentik_proxy_signin;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header       Set-Cookie $auth_cookie;

    # Forward to your actual service
    proxy_pass       http://host.docker.internal:<app-port>;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location @goauthentik_proxy_signin {
    internal;
    add_header Set-Cookie $auth_cookie;
    return 302 /outpost.goauthentik.io/start?rd=$scheme://$http_host$request_uri;
}
```

**Critical detail:** The `proxy_set_header Host $http_host` line must use `$http_host` (includes port) not `$host` (strips port). Getting this wrong causes redirect loops after authentication because the redirect URL doesn't match.

### 5. Reload NPM

```bash
docker exec nginx-proxy-manager nginx -s reload
```

## Native OIDC Setup (Application-Level)

For apps that support OIDC natively (Grafana, Portainer, GitLab, Outline, etc.):

### 1. Create an OAuth2/OIDC Provider

1. Providers > Create > OAuth2/OpenID Provider
2. Name: `grafana-oidc`
3. Client type: Confidential
4. Redirect URIs: `https://grafana.lab.example.com/login/generic_oauth`
5. Note the Client ID and Client Secret

### 2. Create an Application

Link it to the OIDC provider. Set the launch URL to the app's URL.

### 3. Configure the App

Each app is different, but the general pattern in environment variables:

```yaml
environment:
  - GF_AUTH_GENERIC_OAUTH_ENABLED=true
  - GF_AUTH_GENERIC_OAUTH_NAME=Authentik
  - GF_AUTH_GENERIC_OAUTH_CLIENT_ID=<client-id>
  - GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=<client-secret>
  - GF_AUTH_GENERIC_OAUTH_AUTH_URL=https://auth.lab.example.com/application/o/authorize/
  - GF_AUTH_GENERIC_OAUTH_TOKEN_URL=https://auth.lab.example.com/application/o/token/
  - GF_AUTH_GENERIC_OAUTH_API_URL=https://auth.lab.example.com/application/o/userinfo/
  - GF_AUTH_GENERIC_OAUTH_SCOPES=openid profile email
```

## Troubleshooting

**Redirect loop after login:** Check that `proxy_set_header Host $http_host` is set, and that the redirect URI in the provider matches exactly what the app sends (including trailing slashes).

**403 after successful auth:** The user might not be in the right Authentik group. Check Applications > your app > Policy Bindings.

**"Invalid redirect URI" error:** The redirect URI registered in the provider must match the app's callback URL character-for-character. Copy it from the app's docs, don't guess.

**Auth works locally but not externally:** If using Cloudflare Tunnel, Authentik's outpost needs to be reachable from the proxy. Verify the outpost container is running and the port mapping is correct.

## Services to Exclude from Auth

Not everything needs SSO. I leave these public or on separate auth:

- **Plex** — has its own account system
- **The auth server itself** — obvious infinite loop
- **Status pages** — these should be publicly accessible
- **Webhook endpoints** — external services (GitHub, Stripe) can't authenticate through SSO
