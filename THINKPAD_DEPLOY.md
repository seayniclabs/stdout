# ThinkPad Deployment Guide

## Quick Deploy (from ThinkPad)

SSH into the ThinkPad or run directly on the machine:

```bash
cd ~/stdout
git pull origin main
sudo docker compose down
sudo docker compose build --no-cache
sudo docker compose up -d
```

## Clean Deploy (wipes all data)

```bash
cd ~/stdout
git pull origin main
sudo docker compose down -v
sudo rm -rf data/*
sudo docker compose build
sudo docker compose up -d
```

## Test Endpoint (Non-Production Only)

For E2E tests, there's a wipe endpoint at `/app/api/test/wipe-data` that clears all users and setup state. It only works when:
- `NODE_ENV !== 'production'`
- `STDOUT_MODE !== 'production'`

The E2E test automatically calls this endpoint before starting to ensure clean state.

## Manual Wipe (if test endpoint doesn't work)

```bash
# On ThinkPad
cd ~/stdout
sudo docker compose down -v
sudo rm -rf data/*
sudo docker compose up -d
```

## Current Issue (2026-06-09)

E2E test fails at step 1 because:
1. Previous test run created a user account
2. Data wipe (`sudo rm -rf data/*`) didn't remove Docker volume
3. `getUserCount() > 0` redirects `/` to `/app/login` instead of `/setup`

**Solution**: Use the wipe endpoint before each test run, or manually wipe volumes with `docker compose down -v`
