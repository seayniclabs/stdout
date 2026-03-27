// Add-ons panel: ranking logic, store fetch + cache, static fallback

const STORE_API_URL = 'https://store.seayniclabs.com/api/products/featured';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 2000;

export interface Addon {
  id: string;
  name: string;
  tagline: string;
  price: string;
  pricePeriod?: string;
  url: string;
  category?: string;
  tags: string[];
  icon?: string;
}

// Static fallback — used when store API is unreachable (common on air-gapped self-hosted)
export const FALLBACK_ADDONS: Addon[] = [
  {
    id: 'vault-mcp',
    name: 'Obsidian Vault MCP',
    tagline: 'Give Claude direct read/write access to your Obsidian vault.',
    price: '$39',
    url: 'https://store.seayniclabs.com/products/vault-mcp',
    tags: ['obsidian', 'mcp', 'claude', 'vault'],
  },
  {
    id: 'homelab-mcp',
    name: 'Homelab Infrastructure MCP',
    tagline: 'MCP server for Docker, NPM, and Cloudflare Tunnel management.',
    price: '$49',
    url: 'https://store.seayniclabs.com/products/homelab-mcp',
    tags: ['homelab', 'mcp', 'docker', 'infrastructure'],
  },
  {
    id: 'claude-context-kit',
    name: 'Claude Context Kit',
    tagline: 'Production CLAUDE.md configuration for Claude Code.',
    price: '$24',
    url: 'https://store.seayniclabs.com/products/claude-context-kit',
    tags: ['claude', 'configuration', 'productivity'],
  },
  {
    id: 'lathe',
    name: 'Lathe',
    tagline: 'File and media processing MCP server.',
    price: '$19',
    url: 'https://store.seayniclabs.com/products/lathe',
    tags: ['mcp', 'media', 'images', 'files'],
  },
];

// What's New — update when a new vertical ships
export const WHATS_NEW = {
  id: 'network-scanner',
  name: 'Network Scanner Module',
  tagline: 'SNMP discovery, VLAN awareness, device type inference, and full subnet mapping — now built into the scanner.',
  price: 'Included in Self-Hosted',
  url: 'https://stdout.seayniclabs.com/app/docs/guide/scanner-setup',
  isNew: true,
  releasedAt: '2026-03-27',
};

// Coming Soon — teasers for future verticals
export const COMING_SOON = [
  {
    id: 'oncall-toolkit',
    name: 'On-Call Toolkit',
    teaser: 'PagerDuty/Grafana OnCall integration, escalation tracking, shift handoff notes.',
  },
  {
    id: 'msp-multi-tenant',
    name: 'MSP Multi-Tenant',
    teaser: 'Manage multiple client stacks from one console. Per-tenant isolation, team access controls.',
  },
];

// Product relevance map — scanner findings → product IDs
const RELEVANCE_MAP: Record<string, string[]> = {
  'n8n': ['claude-context-kit', 'vault-mcp'],
  'obsidian': ['vault-mcp'],
  'docker': ['homelab-mcp'],
  'portainer': ['homelab-mcp'],
  'nginx': ['homelab-mcp'],
  'traefik': ['homelab-mcp'],
  'cloudflared': ['homelab-mcp'],
  'authentik': ['homelab-mcp', 'vault-mcp'],
  'grafana': ['homelab-mcp'],
  'prometheus': ['homelab-mcp'],
};

/**
 * Fetch products from the store API, with caching and fallback.
 */
export async function fetchAddons(cachedJson?: string | null, cachedAt?: Date | null): Promise<Addon[]> {
  // Check cache
  if (cachedJson && cachedAt) {
    const age = Date.now() - cachedAt.getTime();
    if (age < CACHE_TTL_MS) {
      try {
        return JSON.parse(cachedJson) as Addon[];
      } catch {}
    }
  }

  // Fetch from store API with timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(STORE_API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return (data.products || []) as Addon[];
    }
  } catch {
    // Store unreachable — use fallback
  }

  return FALLBACK_ADDONS;
}

/**
 * Rank add-ons by relevance to detected stack services.
 * Returns top N products, most relevant first.
 */
export function rankAddons(addons: Addon[], detectedServices: string[], limit = 2): Addon[] {
  const scores = new Map<string, number>();

  // Score each product by how many detected services map to it
  for (const service of detectedServices) {
    const normalized = service.toLowerCase().replace(/^.*\//, '').replace(/:.*$/, '');
    const relevant = RELEVANCE_MAP[normalized];
    if (relevant) {
      for (const productId of relevant) {
        scores.set(productId, (scores.get(productId) || 0) + 1);
      }
    }
  }

  // Also score by tag overlap with detected services
  for (const addon of addons) {
    for (const tag of addon.tags) {
      if (detectedServices.some(s => s.toLowerCase().includes(tag))) {
        scores.set(addon.id, (scores.get(addon.id) || 0) + 0.5);
      }
    }
  }

  // Sort: scored products first (by score desc), then by price desc
  return addons
    .filter(a => a.id !== 'stdout' && a.id !== 'hone') // Don't recommend ourselves
    .map(a => ({ addon: a, score: scores.get(a.id) || 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const extractPrice = (p: string) => {
        const match = p.match(/^\$(\d+)/);
        return match ? parseInt(match[1]) : 0;
      };
      const priceA = extractPrice(a.addon.price);
      const priceB = extractPrice(b.addon.price);
      return priceB - priceA;
    })
    .slice(0, limit)
    .map(a => a.addon);
}
