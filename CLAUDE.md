# CLAUDE.md — StdOut

## Project

AI-assisted incident companion for solo developers and self-hosters. Log incidents, get AI diagnosis with stack context, build a living runbook from your own resolutions.

- **Repo:** `charlieseay/stdout` (private)
- **URL (SaaS):** https://stdout.seayniclabs.com
- **URL (internal):** https://stdout.seaynicroute.com
- **Port:** 8112
- **Container config:** `/Volumes/data/containers/stdout/`
- **Vault note:** `Projects/StdOut/StdOut.md`

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro (SSR mode, `@astrojs/node` adapter) |
| Auth | Argon2id password hashing, session cookies |
| Database | SQLite via Drizzle ORM |
| AI | Claude API via `@anthropic-ai/sdk` |
| Search | SQLite FTS5 (full-text search over incidents + resolutions) |
| Hosting | Docker → nginx:alpine → NPM → Cloudflare Tunnel |
| Billing | Stripe (shared with seayniclabs.com) |

## Commands

```bash
npm run dev          # Dev server at localhost:4321
npm run build        # Production build
npm run start        # Run production server
```

## Architecture

```
src/
├── lib/
│   ├── db/          # Drizzle schema + SQLite init
│   ├── auth.ts      # Session management (cookie: sl_session)
│   └── diagnose.ts  # Claude API integration
├── pages/
│   ├── app/         # Auth'd app routes
│   │   ├── api/     # API endpoints (incidents CRUD, diagnose, me)
│   │   └── ...      # Dashboard, incident detail, stacks, etc.
│   └── index.astro  # Landing redirect
├── layouts/         # Page layouts (coral StdOut brand)
└── styles/          # Global CSS (design tokens)
```

## Brand

- **Accent:** Coral (#F97316)
- **Background:** #07070C (near-black)
- **Typography:** Inter (UI) + JetBrains Mono (data/code)
- **Cookie domain:** .seayniclabs.com (shared auth with store)

## Database Tables

- `users` — auth, subscription, Stripe
- `sessions` — session tokens
- `stacks` — infrastructure descriptions (Markdown)
- `incidents` — incident log with severity, status, tags
- `resolutions` — what fixed each incident
- `diagnoses` — AI diagnosis results with token usage
- `incidents_fts` / `resolutions_fts` — FTS5 virtual tables

## Security Posture

Same security patterns as Hone (battle-tested):

| Layer | Protection |
|-------|-----------|
| CSRF | Origin check + double-submit cookie |
| Rate limiting | IP-based, 10/15min on auth endpoints |
| Account lockout | 5 failures → 15min lock |
| Nonce CSP | Per-request nonce on scripts |
| Cookie security | httpOnly, secure, sameSite=lax |
| Session | nanoid(32), 30-day expiry |
| Passwords | Argon2id |

## Standards

- Follow `Standards/Security.md`
- Follow `Standards/Bug Tracking.md` — file bugs in `Projects/StdOut/Bugs/`
- All Docker containers: `TZ=America/Chicago`
- Secrets: `<placeholder>` format in docs
