# StdOut Site — Project Header

**Project:** StdOut Marketing Site  
**Type:** Static Product Landing  
**Status:** Active  
**Deployment:** Cloudflare Pages  
**URL:** https://stdout.seayniclabs.com  
**Last Updated:** 2026-06-10

## Project Identity

StdOut Site is a static Astro product landing page showcasing the StdOut incident companion platform (the live app runs separately at seaynicroute.com:8112). Marketing entry point for self-hosted incident tracking + AI diagnostics + Windlass scheduling + Observatory monitoring.

## Assessment — 2026-06-10

### Errors & Risks
[LOW] Static marketing site — no runtime risks; all content-driven

### Security
[PASS] No backend, forms, or webhooks — attack surface zero
[PASS] Cloudflare Pages auto-SSL + global DDoS protection

### Improvements
Add setup CTA linking to production StdOut installer (seaynicroute.com/setup)
Implement versioned docs (docs.stdout.seayniclabs.com) for old release troubleshooting
Add pricing calculator (self-host cost vs SaaS, Ollama memory requirements)

### Cost
Cloudflare Pages free; static assets cached globally

### Performance
Astro SSG + CDN fast; no API calls or database queries

### Verdict
**Grade: A** — Simple marketing site. Add setup CTA + docs versioning for improved user onboarding.

## Current State

StdOut Site is a static Astro 5.17 product landing page live at https://stdout.seayniclabs.com. Clean repository (no uncommitted changes). Deployed via Cloudflare Pages to seayniclabs.com domain. Showcases StdOut features (incident tracking, AI diagnostics, Windlass scheduling, Observatory monitoring); no backend integration except links to GitHub repo and store. Site is production-stable and serves as primary StdOut marketing entry point.

## Tech Stack

- **Framework:** Astro 5.17
- **Build:** Static site generation (SSG)
- **Deployment:** Cloudflare Pages
- **Domain:** stdout.seayniclabs.com

## Development

```bash
npm install
npm run dev  # http://localhost:3000
npm run build  # outputs to dist/
```

## Next Steps

1. **[Priority: Med]** Add setup CTA — direct link to production installer (seaynicroute.com/setup)
2. **[Priority: Med]** Versioned docs site — support multiple release versions with archived docs
3. **[Priority: Low]** Pricing calculator — estimate self-host costs (CPU/RAM for Ollama) vs SaaS
