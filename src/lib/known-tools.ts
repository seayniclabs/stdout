// Known tool registry — tools StdOut recognizes, has add-ons for, or has evaluated.
// Compared against scanner output to detect unknown tools.
// Update this list as new add-ons ship.

export const KNOWN_TOOLS = new Set([
  // Infrastructure
  'nginx', 'traefik', 'caddy', 'haproxy', 'apache',
  'portainer', 'docker', 'podman', 'containerd',
  'cloudflare', 'cloudflared',

  // Monitoring & Observability
  'prometheus', 'grafana', 'loki', 'tempo', 'mimir',
  'influxdb', 'telegraf', 'netdata', 'uptime-kuma',
  'healthchecks', 'statping',

  // Automation
  'n8n', 'node-red', 'huginn', 'activepieces',

  // Auth
  'authentik', 'authelia', 'keycloak', 'zitadel',

  // Databases
  'postgres', 'postgresql', 'mysql', 'mariadb', 'redis',
  'sqlite', 'mongodb', 'influxdb',

  // Code / CI
  'gitea', 'gitlab', 'drone', 'woodpecker', 'jenkins',
  'github-actions', 'act',

  // Media
  'plex', 'jellyfin', 'emby', 'sonarr', 'radarr',
  'prowlarr', 'bazarr', 'overseerr', 'tautulli',

  // Security
  'crowdsec', 'fail2ban', 'trivy', 'vaultwarden', 'zeek', 'suricata',

  // Storage
  'minio', 'nextcloud', 'syncthing', 'restic',

  // DNS
  'pihole', 'adguard', 'blocky', 'coredns',

  // Misc self-hosted
  'homeassistant', 'home-assistant', 'homepage',
  'homarr', 'dashy', 'flame',
  'miniflux', 'freshrss', 'wallabag',
  'mealie', 'tandoor', 'grocy',
  'bookstack', 'wiki-js', 'outline',
  'immich', 'photoprism',
  'actual', 'firefly-iii',
]);

/**
 * Normalize a container image/name to a tool name for matching.
 * e.g. "linuxserver/sonarr:latest" → "sonarr"
 */
export function normalizeToolName(raw: string): string {
  return raw
    .replace(/^.*\//, '')       // strip registry/org prefix
    .replace(/:.*$/, '')        // strip tag
    .replace(/-official$/, '')  // strip common suffixes
    .toLowerCase()
    .trim();
}

/**
 * Check if a tool is known. Returns true if recognized.
 */
export function isKnownTool(name: string): boolean {
  const normalized = normalizeToolName(name);
  return KNOWN_TOOLS.has(normalized);
}

/**
 * Given a list of detected container names/images, return the unknown ones.
 */
export function findUnknownTools(detected: string[]): string[] {
  return detected
    .map(normalizeToolName)
    .filter(name => name.length > 0 && !KNOWN_TOOLS.has(name));
}
