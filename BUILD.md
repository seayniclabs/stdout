# Building StdOut for Multi-Platform

StdOut supports both AMD64 (x86_64) and ARM64 architectures. This guide covers building images for all supported platforms.

**Registry:** Docker Hub at `charlieseay/stdout`

## Quick Build (Current Platform Only)

```bash
cd /path/to/stdout
docker build -t charlieseay/stdout:latest .
```

This builds for your current architecture only (e.g., ARM64 on Mac M-series, AMD64 on Intel).

## Multi-Platform Build (Production)

To build for both AMD64 and ARM64:

```bash
# Create and use buildx builder (one-time setup)
docker buildx create --name multiarch --use

# Build for both platforms
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t charlieseay/stdout:latest \
  --push \
  .
```

**Note:** `--push` is required for multi-platform builds (images are pushed to registry, not loaded locally).

## Build for Specific Platform

### AMD64 (Intel/AMD servers, most cloud VMs)
```bash
docker buildx build \
  --platform linux/amd64 \
  -t charlieseay/stdout:latest \
  --load \
  .
```

### ARM64 (Raspberry Pi 4/5, Apple Silicon, ARM servers)
```bash
docker buildx build \
  --platform linux/arm64 \
  -t charlieseay/stdout:latest \
  --load \
  .
```

## Native Dependencies

StdOut includes native Node.js modules that must be compiled for the target architecture:

- `@node-rs/argon2` — Password hashing (Rust-based)
- `better-sqlite3` — SQLite bindings (C++ based)

The Dockerfile includes build tools (`python3 make g++`) to compile these during the build process. Cross-compilation is handled automatically by Docker buildx.

## Verifying Multi-Arch Support

Check the manifest to see which platforms are available:

```bash
docker buildx imagetools inspect charlieseay/stdout:latest
```

Example output:
```
Name:      charlieseay/stdout:latest
MediaType: application/vnd.docker.distribution.manifest.list.v2+json
Digest:    sha256:abc123...
           
Manifests: 
  Name:      charlieseay/stdout:latest@sha256:def456...
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/amd64
           
  Name:      charlieseay/stdout:latest@sha256:ghi789...
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/arm64
```

## Testing on Raspberry Pi

After pushing a multi-arch image, test on a Raspberry Pi:

```bash
# On Raspberry Pi (ARM64)
docker pull charlieseay/stdout:latest
docker run --rm charlieseay/stdout:latest uname -m
# Expected output: aarch64
```

## Troubleshooting

### "exec format error"
This means you're trying to run an image built for a different architecture. Use buildx to build for the correct platform.

### Native module build failures
If native modules fail to compile, check that the base image (`node:22-alpine`) includes build tools:
- `python3` (for node-gyp)
- `make`
- `g++` (C++ compiler)

These are installed in the build stage and removed in the runtime stage to keep the final image small.

## Build Scripts

For convenience, add these npm scripts to `package.json`:

```json
{
  "scripts": {
    "docker:build": "docker build -t charlieseay/stdout:latest .",
    "docker:build:amd64": "docker buildx build --platform linux/amd64 -t charlieseay/stdout:latest --load .",
    "docker:build:arm64": "docker buildx build --platform linux/arm64 -t charlieseay/stdout:latest --load .",
    "docker:build:multiarch": "docker buildx build --platform linux/amd64,linux/arm64 -t charlieseay/stdout:latest --push ."
  }
}
```

## CI/CD Integration

GitHub Actions example for automated multi-arch builds:

```yaml
name: Build and Push Multi-Arch Image

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: charlieseay/stdout:latest
```

## License Validation

For production builds that require license validation before image pull, see `INSTALL.md` section on license activation methods.
