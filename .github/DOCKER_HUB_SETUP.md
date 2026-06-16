# Docker Hub Automated Publishing Setup

## Overview

This repository automatically publishes Docker images to Docker Hub on every push to `main` using GitHub Actions.

## Setup Instructions

### 1. Create Docker Hub Personal Access Token

1. Go to https://hub.docker.com/settings/security
2. Click **New Access Token**
3. Name: `github-actions-stdout`
4. Access permissions: **Read, Write, Delete**
5. Click **Generate**
6. **Copy the token immediately** (you won't see it again)

### 2. Add GitHub Secret

1. Go to https://github.com/seayniclabs/stdout/settings/secrets/actions
2. Click **New repository secret**
3. Name: `DOCKERHUB_TOKEN`
4. Value: paste the token from step 1
5. Click **Add secret**

### 3. Verify Workflow

Once the secret is added, the workflow will run automatically on the next push to `main`. You can also trigger it manually:

1. Go to https://github.com/seayniclabs/stdout/actions
2. Select **Build and Push to Docker Hub** workflow
3. Click **Run workflow** → **Run workflow**

## What Gets Published

- **Latest tag**: Always points to the most recent `main` build
- **Branch tag**: Tagged with branch name (e.g., `main`)
- **SHA tag**: Tagged with git commit SHA (e.g., `main-a1b2c3d`)
- **Multi-platform**: Both `linux/amd64` and `linux/arm64`

## Published Image

https://hub.docker.com/r/charlieseay/stdout

## Local Testing

To test the build locally without pushing:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t charlieseay/stdout:test .
```

## Security Notes

- The `DOCKERHUB_TOKEN` secret is only accessible to workflows in this repository
- GitHub Actions masks the token in all log output
- The token has write access only to the `charlieseay/stdout` repository on Docker Hub
- Revoke the token immediately if compromised: https://hub.docker.com/settings/security
