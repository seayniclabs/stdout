export interface StackTemplate {
  name: string;
  description: string;
  tags: string;
}

export const stackTemplates: StackTemplate[] = [
  {
    name: 'Docker + Nginx Reverse Proxy',
    description: `## Host
- Docker containers behind nginx reverse proxy
- SSL termination at nginx (Let's Encrypt or Cloudflare)

## Services
- **nginx** — reverse proxy on :80/:443, routes traffic to backend containers
- Update container services and ports below to match your setup

## Common Issues
- 502 Bad Gateway: backend container stopped or wrong port
- SSL cert renewal: check Let's Encrypt cron or Cloudflare tunnel
- DNS: verify A/CNAME records point to this host`,
    tags: 'docker,nginx,proxy',
  },
  {
    name: 'Docker + Cloudflare Tunnel',
    description: `## Host
- Docker containers exposed via Cloudflare Tunnel (cloudflared)
- No open inbound ports — all traffic routes through CF

## Services
- **cloudflared** — tunnel daemon, connects to Cloudflare edge
- Backend services only accessible through tunnel ingress rules

## Common Issues
- Tunnel offline: check cloudflared container logs
- 502 errors: ingress rule pointing to wrong hostname/port
- SSL: Cloudflare handles termination, internal traffic is HTTP`,
    tags: 'docker,cloudflare,tunnel',
  },
  {
    name: 'n8n Workflow Automation',
    description: `## Stack
- **n8n** — workflow automation on :5678
- **PostgreSQL** — n8n backend database

## Configuration
- Webhook URL: https://your-domain/webhook/
- Execution data: only errors saved (EXECUTIONS_DATA_SAVE_ON_SUCCESS=none)

## Common Issues
- Cron triggers not firing: restart n8n container after API workflow changes
- Memory: n8n can spike during bulk operations — monitor container memory
- Webhook 404: check workflow is active and trigger path matches`,
    tags: 'n8n,postgres,automation',
  },
  {
    name: 'Media Server (Plex + *arr)',
    description: `## Stack
- **Plex** — media server on :32400
- **Sonarr** — TV show management
- **Radarr** — movie management
- **Prowlarr** — indexer management
- **qBittorrent** — download client (behind VPN/Gluetun)

## Storage
- Media library mounted from NAS or local disk
- Download directory separate from library (hardlinks for completed)

## Common Issues
- Plex not scanning: check library permissions and mount paths
- Downloads stuck: VPN container (Gluetun) may have lost connection
- Indexers failing: check Prowlarr → Indexers for error status`,
    tags: 'plex,sonarr,radarr,media',
  },
  {
    name: 'Monitoring Stack',
    description: `## Stack
- **Grafana** — dashboards and visualization on :3000
- **InfluxDB** / **Prometheus** — time series database
- **Netdata** — real-time host metrics on :19999

## Data Flow
- Netdata collects host/container metrics → exports to InfluxDB/Prometheus
- Grafana queries time series DB for dashboard panels

## Common Issues
- Grafana data source error: check DB connectivity and credentials
- High disk usage: retention policy may need tightening
- Missing metrics: verify Netdata is collecting from Docker socket`,
    tags: 'grafana,influxdb,prometheus,monitoring',
  },
  {
    name: 'Authentication (Authentik)',
    description: `## Stack
- **Authentik Server** — SSO/OIDC provider on :9000
- **Authentik Worker** — background task processor
- **PostgreSQL** — Authentik backend database
- **Redis** — session/cache store

## Configuration
- OIDC Applications configured per-service
- Forward auth or proxy provider for nginx integration

## Common Issues
- Login redirect loop: check OIDC redirect URIs match exactly
- Worker unhealthy: check Redis connectivity
- Slow auth: PostgreSQL may need vacuuming`,
    tags: 'authentik,sso,oidc,auth',
  },
];
