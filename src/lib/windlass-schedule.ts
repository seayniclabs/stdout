const INFRA_IMAGES = /nginx|traefik|cloudflared|authentik|caddy|haproxy/i;
const DB_IMAGES = /postgres|mysql|mariadb|redis|mongo|influx|timescale/i;
const MEDIA_IMAGES = /plex|sonarr|radarr|jellyfin|emby|lidarr|readarr|bazarr|prowlarr|overseerr/i;

type ScannerContainer = {
  name?: string;
  image?: string;
  compose_project?: string;
  compose_path?: string;
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function classifyType(image: string, name: string): 'always' | 'schedule' {
  const hay = `${image} ${name}`;
  if (MEDIA_IMAGES.test(hay)) return 'schedule';
  if (INFRA_IMAGES.test(hay) || DB_IMAGES.test(hay)) return 'always';
  return 'always';
}

export function generateScheduleYamlFromScan(rawJson: string): string | null {
  let data: { containers?: ScannerContainer[] };
  try {
    data = JSON.parse(rawJson);
  } catch {
    return null;
  }

  const byProject = new Map<string, { composePath?: string; containers: ScannerContainer[] }>();

  for (const c of data.containers || []) {
    const project = c.compose_project || 'default';
    if (!byProject.has(project)) {
      byProject.set(project, { composePath: c.compose_path, containers: [] });
    }
    const entry = byProject.get(project)!;
    if (c.compose_path && !entry.composePath) entry.composePath = c.compose_path;
    entry.containers.push(c);
  }

  const lines: string[] = ['services:'];

  for (const [project, { composePath, containers }] of byProject) {
    const serviceKey = slugify(project) || 'stack';
    const names = containers.map(c => c.name).filter(Boolean) as string[];
    if (names.length === 0) continue;

    const sample = containers[0];
    const type = classifyType(sample.image || '', sample.name || project);

    lines.push(`  ${serviceKey}:`);
    if (composePath) lines.push(`    compose_path: ${composePath}`);
    lines.push(`    containers: [${names.join(', ')}]`);
    lines.push(`    type: ${type}`);
    lines.push('');
  }

  return lines.length > 1 ? lines.join('\n').trimEnd() + '\n' : null;
}
