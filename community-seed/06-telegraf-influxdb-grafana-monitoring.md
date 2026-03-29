---
title: "Monitoring Containers with Telegraf + InfluxDB + Grafana"
type: guide
tags: monitoring, telegraf, influxdb, grafana, docker, metrics
---

## Purpose

Set up a metrics pipeline that collects container stats, system metrics, and HTTP endpoint health — then visualizes everything in Grafana dashboards. This is the TIG stack (Telegraf, InfluxDB, Grafana), the self-hosted equivalent of Datadog for your home lab.

## Architecture

```
Containers/System → Telegraf (collector) → InfluxDB (storage) → Grafana (visualization)
```

Telegraf scrapes metrics on an interval (10s default), writes them to InfluxDB, and Grafana queries InfluxDB to render dashboards. Each component runs in its own container.

## Docker Compose

```yaml
services:
  influxdb:
    image: influxdb:2
    restart: unless-stopped
    ports:
      - "8086:8086"
    volumes:
      - ./influxdb/data:/var/lib/influxdb2
      - ./influxdb/config:/etc/influxdb2
    environment:
      - TZ=America/Chicago
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=<your-password>
      - DOCKER_INFLUXDB_INIT_ORG=homelab
      - DOCKER_INFLUXDB_INIT_BUCKET=telegraf
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=<your-token>

  telegraf:
    image: telegraf:latest
    restart: unless-stopped
    volumes:
      - ./telegraf/telegraf.conf:/etc/telegraf/telegraf.conf:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - TZ=America/Chicago
    depends_on:
      - influxdb
    # On macOS, Docker socket path may differ — check Docker Desktop settings

  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./grafana/data:/var/lib/grafana
    environment:
      - TZ=America/Chicago
      - GF_SECURITY_ADMIN_PASSWORD=<your-password>
```

## Telegraf Configuration

The Telegraf config (`telegraf.conf`) defines what to collect and where to send it.

```toml
[global_tags]
  lab = "homelab"

[agent]
  interval = "10s"
  round_interval = true
  flush_interval = "10s"

# ── Output: InfluxDB v2 ──
[[outputs.influxdb_v2]]
  urls = ["http://influxdb:8086"]
  token = "<your-influxdb-token>"
  organization = "homelab"
  bucket = "telegraf"

# ── System metrics ──
[[inputs.cpu]]
  percpu = true
  totalcpu = true

[[inputs.mem]]

[[inputs.disk]]
  ignore_fs = ["tmpfs", "devtmpfs", "devfs", "overlay"]

[[inputs.net]]

# ── Docker container metrics ──
[[inputs.docker]]
  endpoint = "unix:///var/run/docker.sock"
  gather_services = false
  container_names = []  # Empty = all containers
  perdevice = false
  total = true

# ── HTTP endpoint checks ──
[[inputs.http_response]]
  urls = [
    "http://host.docker.internal:8100",
    "http://host.docker.internal:8101",
    "http://host.docker.internal:9010",
  ]
  response_timeout = "5s"
  method = "GET"
  follow_redirects = true
```

### Key Inputs Explained

- **docker** — CPU, memory, network, and block I/O per container. Requires Docker socket access.
- **http_response** — Checks if services respond and measures latency. Use `host.docker.internal` on macOS since Telegraf runs in a container.
- **cpu/mem/disk** — Host-level system metrics.

## Grafana Setup

### 1. Add InfluxDB Data Source

1. Grafana > Configuration > Data Sources > Add
2. Type: InfluxDB
3. Query language: **Flux** (InfluxDB v2 uses Flux, not InfluxQL)
4. URL: `http://influxdb:8086` (container-to-container)
5. Organization: `homelab`
6. Token: your InfluxDB admin token
7. Default bucket: `telegraf`
8. Click "Save & Test"

### 2. Essential Dashboard Panels

**Container CPU Usage:**
```flux
from(bucket: "telegraf")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "docker_container_cpu")
  |> filter(fn: (r) => r._field == "usage_percent")
  |> aggregateWindow(every: 1m, fn: mean)
```

**Container Memory:**
```flux
from(bucket: "telegraf")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "docker_container_mem")
  |> filter(fn: (r) => r._field == "usage_percent")
  |> aggregateWindow(every: 1m, fn: mean)
```

**HTTP Endpoint Latency:**
```flux
from(bucket: "telegraf")
  |> range(start: -6h)
  |> filter(fn: (r) => r._measurement == "http_response")
  |> filter(fn: (r) => r._field == "response_time")
  |> aggregateWindow(every: 5m, fn: mean)
```

## Retention and Storage

InfluxDB v2 uses retention policies per bucket. For a home lab:

- **telegraf** bucket: 30-day retention (detailed metrics)
- **telegraf-longterm** bucket: 365-day retention (downsampled to 1h aggregates)

Create a downsampling task in InfluxDB to roll up data:

```flux
option task = {name: "downsample-hourly", every: 1h}

from(bucket: "telegraf")
  |> range(start: -2h)
  |> aggregateWindow(every: 1h, fn: mean)
  |> to(bucket: "telegraf-longterm")
```

## Troubleshooting

**Telegraf can't connect to Docker socket:** On macOS with Docker Desktop, the socket is at `/var/run/docker.sock` but permissions can be tricky. Check that the volume mount is correct and the Telegraf container can read it.

**No data in Grafana:** Verify Telegraf is writing data: check `docker logs telegraf` for write errors. Common cause: wrong token or organization name in the output config.

**High disk usage from InfluxDB:** Set retention policies. Without them, metrics accumulate forever. A 50-container lab generating metrics every 10s can produce several GB per month.

## What This Gets You

After setup, you'll have visibility into:

- Which containers are consuming the most CPU and memory
- Container restart patterns (sudden drops in uptime metrics)
- HTTP endpoint response times and availability
- Disk fill rates (critical for planning storage expansion)
- Network throughput per container

This is the foundation for alerting — Grafana can send notifications when metrics cross thresholds, giving you an early warning system for your entire lab.
