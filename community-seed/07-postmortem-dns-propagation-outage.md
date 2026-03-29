---
title: "Postmortem: DNS Propagation Delay Caused 2-Hour Service Outage"
type: postmortem
tags: dns, cloudflare, outage, postmortem, networking
---

## Incident Summary

| Field | Detail |
|-------|--------|
| **Date** | 2026-02-15 |
| **Duration** | ~2 hours |
| **Severity** | High — all externally-routed services unreachable |
| **Root Cause** | CNAME target changed without accounting for DNS cache TTL |
| **Impact** | All `*.lab.example.com` services returned DNS resolution failures for external users |

## Timeline

**14:00** — Decided to recreate the Cloudflare Tunnel to clean up stale ingress rules. Deleted the old tunnel and created a new one. This generated a new tunnel ID.

**14:05** — Updated `~/.cloudflared/config.yml` with the new tunnel ID and credentials file. Restarted `cloudflared`. Tunnel connected successfully — confirmed in the Cloudflare dashboard.

**14:10** — Tried accessing `app.lab.example.com` from my phone (off-network). Got `DNS_PROBE_FINISHED_NXDOMAIN`. Realized the wildcard CNAME still pointed to the old tunnel ID (`old-tunnel-id.cfargotunnel.com`).

**14:15** — Updated the CNAME record to point to the new tunnel ID. Cloudflare dashboard showed the record as active. Assumed it would propagate instantly since Cloudflare is the authoritative nameserver.

**14:20** — Still getting NXDOMAIN from my phone. Tried from a different network — same result. Flushed local DNS cache. No change.

**14:45** — Checked with `dig` from multiple resolvers:

```bash
dig app.lab.example.com @1.1.1.1 +short  # Empty
dig app.lab.example.com @8.8.8.8 +short   # Empty
dig app.lab.example.com @9.9.9.9 +short   # Still returning old CNAME
```

The old CNAME was cached by upstream resolvers with the previous TTL (which had been set to "Auto" — defaulting to 300s / 5 minutes). But because the old tunnel ID no longer existed, resolvers were caching the NXDOMAIN response from the old target.

**15:00** — Realized the issue: when the old CNAME target (`old-tunnel-id.cfargotunnel.com`) stopped resolving, some recursive resolvers cached the negative response (NXDOMAIN) with their own TTL, which can be longer than 5 minutes. Updating the CNAME in Cloudflare was immediate on their authoritative DNS, but downstream resolvers held stale negative caches.

**15:30** — Started seeing resolution from some resolvers. `1.1.1.1` recovered first (Cloudflare's own resolver respects their authoritative TTL). Google DNS (`8.8.8.8`) took longer.

**16:00** — All resolvers returning the correct CNAME. All services accessible. Confirmed from multiple devices and networks.

## Root Cause

Deleting a Cloudflare Tunnel before updating DNS records creates a window where the CNAME target doesn't exist. Recursive DNS resolvers cache this negative response (RFC 2308), and the negative cache TTL is controlled by the target zone's SOA record, not your Cloudflare TTL settings. Cloudflare's `cfargotunnel.com` zone has its own SOA minimum TTL that you don't control.

The correct order is: update DNS first, then delete the old tunnel. Or better: keep both tunnels running briefly during migration.

## What Went Wrong

1. **Deleted the old tunnel before creating the new one.** Should have created the new tunnel first, updated DNS to point to it, verified resolution, then deleted the old tunnel.
2. **Assumed Cloudflare DNS changes propagate instantly everywhere.** They propagate instantly on Cloudflare's authoritative servers, but downstream recursive resolvers (Google, Quad9, ISP resolvers) cache records independently.
3. **No pre-change checklist.** This was a "quick cleanup" that turned into an outage because I didn't think through the order of operations.

## What Went Right

- Local access via direct IP was unaffected (only DNS-dependent routing broke).
- The tunnel itself was healthy — the problem was purely DNS.
- Monitoring caught the issue within 10 minutes.

## Action Items

- [ ] **Tunnel migration procedure:** Always create the new tunnel first, update DNS, verify, then delete the old tunnel. Never leave a gap where the CNAME target doesn't exist.
- [ ] **Lower TTL before DNS changes:** Set TTL to 60s at least 24 hours before any planned DNS migration. Restore after cutover.
- [ ] **Add DNS resolution check to monitoring:** External DNS resolution check from outside the network (not just HTTP health checks, which bypass DNS when run locally).
- [ ] **Document the procedure:** Write a runbook for tunnel recreation so the next time isn't ad-hoc.

## Lessons

DNS is the one layer where "it works on my machine" is meaningless. Your local resolver, your ISP's resolver, and Google's resolver can all have different cached states at the same time. The only way to validate a DNS change is to query multiple public resolvers from outside your network, and wait for the longest TTL to expire.
