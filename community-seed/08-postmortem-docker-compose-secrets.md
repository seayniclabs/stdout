---
title: "Postmortem: Docker Compose Secret Misconfiguration Leaked Environment Variables"
type: postmortem
tags: docker, secrets, security, compose, postmortem
---

## Incident Summary

| Field | Detail |
|-------|--------|
| **Date** | 2026-01-22 |
| **Duration** | ~4 hours (discovery to remediation) |
| **Severity** | Medium — no external exposure, but credentials were in container inspect output |
| **Root Cause** | Secrets passed as environment variables instead of Docker secrets or mounted files |
| **Impact** | Database passwords, API tokens, and SSO client secrets visible to anyone with Docker CLI access |

## What Happened

During a routine audit of container configurations, I ran `docker inspect` on the Authentik stack to check volume mounts. In the output, I noticed the full environment block:

```json
"Env": [
    "AUTHENTIK_SECRET_KEY=actual-secret-key-here",
    "AUTHENTIK_POSTGRESQL__PASSWORD=actual-db-password",
    "AUTHENTIK_EMAIL__PASSWORD=actual-smtp-password",
    "PG_PASS=actual-db-password"
]
```

Every secret was visible in plaintext. This wasn't just Authentik — I checked other stacks and found the same pattern across 12 containers. API tokens, database passwords, OAuth client secrets — all passed as environment variables in `docker-compose.yml`.

## Why This Is a Problem

Environment variables in Docker are:

1. **Visible in `docker inspect`** — anyone with Docker CLI access sees them in plaintext
2. **Visible in `/proc/<pid>/environ`** inside the container — any process in the container can read them
3. **Logged by some applications** — frameworks that dump env vars on startup (Rails, Django debug mode) will write secrets to log files
4. **Included in `docker commit`** — if you ever commit a container to an image, the env vars are baked in
5. **Visible in Portainer** — the container details page shows all environment variables

In a single-user home lab, the blast radius is small. But it's still bad practice, and it becomes a real vulnerability if you ever share Docker access, expose Portainer, or push a committed image.

## The Fix

### Option 1: File-Based Secrets (Recommended for Compose)

Instead of environment variables, mount secrets as files:

```yaml
# docker-compose.yml
services:
  authentik-server:
    image: ghcr.io/goauthentik/server:latest
    environment:
      - AUTHENTIK_SECRET_KEY_FILE=/run/secrets/authentik_secret_key
      - AUTHENTIK_POSTGRESQL__PASSWORD_FILE=/run/secrets/db_password
    volumes:
      - ./secrets/authentik_secret_key:/run/secrets/authentik_secret_key:ro
      - ./secrets/db_password:/run/secrets/db_password:ro
```

Create the secret files:

```bash
mkdir -p ./secrets
echo -n "your-secret-key" > ./secrets/authentik_secret_key
echo -n "your-db-password" > ./secrets/db_password
chmod 600 ./secrets/*
```

**Important:** The `_FILE` suffix convention is supported by many images (Authentik, PostgreSQL, MySQL, Redis, Grafana). The entrypoint script reads the file and sets the environment variable internally. Check your image's docs — not all support this pattern.

### Option 2: Docker Compose Secrets (Without Swarm)

Docker Compose v2 supports file-based secrets without Docker Swarm:

```yaml
services:
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

This mounts the secret at `/run/secrets/db_password` inside the container. It's functionally the same as a volume mount but uses Compose's secrets syntax, which is cleaner.

**Do not use `docker swarm init` to enable Swarm-mode secrets.** On macOS, Swarm mode breaks container-to-host networking (containers lose the ability to reach LAN addresses). File-based secrets work without Swarm.

### Option 3: .env File (Partial Improvement)

Move secrets to a `.env` file and reference them in Compose:

```yaml
# docker-compose.yml
services:
  app:
    environment:
      - DB_PASSWORD=${DB_PASSWORD}
```

```bash
# .env (same directory as docker-compose.yml)
DB_PASSWORD=your-password
```

This keeps secrets out of the Compose file itself (important if it's in git), but they're still environment variables — still visible in `docker inspect`. This is a step up from hardcoding, but file-based secrets are better.

## Remediation Steps

1. Identified all containers using plaintext environment secrets: 12 containers across 4 stacks
2. For each, checked whether the image supports `_FILE` suffix or file-mount patterns
3. Created a `secrets/` directory in each stack's config folder
4. Generated new credentials (rotated — the old ones were considered exposed)
5. Updated `docker-compose.yml` to use file mounts
6. Added `secrets/` to `.gitignore` in any stack that's version-controlled
7. Restarted each stack and verified the app connected successfully
8. Re-ran `docker inspect` to confirm environment block no longer shows secrets

## Action Items

- [x] Rotate all credentials that were exposed via environment variables
- [x] Migrate all stacks to file-based secrets
- [x] Add `secrets/` to `.gitignore` in all stack directories
- [ ] Add a pre-commit hook or CI check that scans `docker-compose.yml` for inline secrets
- [ ] Document the secrets pattern in the lab's operational standards

## Prevention

**Rule:** Never put secrets directly in `docker-compose.yml` or pass them as bare `environment:` values. Use file-based secrets (`_FILE` suffix or volume mounts) for all credentials. Keep secret files in a `secrets/` directory with `chmod 600`, and ensure that directory is in `.gitignore`.
