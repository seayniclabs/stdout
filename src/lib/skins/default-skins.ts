// ============================================================================
// DEFAULT SKINS — 5 BUILT-IN SKINS SHIPPED WITH STDOUT
// ============================================================================
// These skins provide immediate variety and demonstrate the theming system.
// Users can select any of these from Settings > Appearance.
// ============================================================================

export interface SkinDefinition {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  isBuiltIn: boolean;
  tags: string[];
  colors: {
    bg: string;
    bgSurface: string;
    bgElevated: string;
    bgHover: string;
    border: string;
    borderHover: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentLight: string;
    accentBright: string;
    accentDim: string;
    accentGlow: string;
    accentBtn: string;
    critical: string;
    criticalDim: string;
    criticalGlow: string;
    high: string;
    highDim: string;
    highGlow: string;
    medium: string;
    mediumDim: string;
    low: string;
    lowDim: string;
    lowGlow: string;
    resolved: string;
    teal: string;
    tealDim: string;
    tealGlow: string;
    glassBg: string;
    glassBorder: string;
  };
  typography?: {
    fontUi?: string;
    fontMono?: string;
  };
  spacing?: {
    radius?: string;
    radiusSm?: string;
    radiusLg?: string;
    transition?: string;
  };
  shadows?: {
    shadowSm?: string;
    shadowMd?: string;
    shadowLg?: string;
    shadowXl?: string;
    shadowGlow?: string;
    shadowInset?: string;
  };
  effects?: {
    glassBlur?: string;
  };
}

// ============================================================================
// SKIN 1: OBSIDIAN (DEFAULT) — Current StdOut dark theme
// ============================================================================
export const skinObsidian: SkinDefinition = {
  id: 'built-in-obsidian',
  name: 'Obsidian',
  description: 'Deep blacks with coral accent — the default StdOut theme',
  author: 'StdOut Team',
  version: '1.0.0',
  isBuiltIn: true,
  tags: ['dark', 'modern'],
  colors: {
    bg: '#07070C',
    bgSurface: '#0E0E18',
    bgElevated: '#151522',
    bgHover: '#1A1A2A',
    border: '#1F1F35',
    borderHover: '#2D2D4A',
    text: '#F0F0F8',
    textSecondary: '#A0A0B8',
    textMuted: '#8888A0',
    accent: '#F97316',
    accentLight: '#FB923C',
    accentBright: '#FF8C3A',
    accentDim: 'rgba(249, 115, 22, 0.12)',
    accentGlow: 'rgba(249, 115, 22, 0.25)',
    accentBtn: '#C2410C',
    critical: '#F04848',
    criticalDim: 'rgba(240, 72, 72, 0.14)',
    criticalGlow: 'rgba(240, 72, 72, 0.35)',
    high: '#F5BC06',
    highDim: 'rgba(245, 188, 6, 0.14)',
    highGlow: 'rgba(245, 188, 6, 0.30)',
    medium: '#FACC15',
    mediumDim: 'rgba(250, 204, 21, 0.12)',
    low: '#34D46A',
    lowDim: 'rgba(52, 212, 106, 0.14)',
    lowGlow: 'rgba(52, 212, 106, 0.30)',
    resolved: '#55556A',
    teal: '#2DD4BF',
    tealDim: 'rgba(45, 212, 191, 0.12)',
    tealGlow: 'rgba(45, 212, 191, 0.25)',
    glassBg: 'rgba(14, 14, 24, 0.6)',
    glassBorder: 'rgba(255, 255, 255, 0.06)',
  },
};

// ============================================================================
// SKIN 2: GLACIER — Blue-tinted dark theme with cyan accents
// ============================================================================
export const skinGlacier: SkinDefinition = {
  id: 'built-in-glacier',
  name: 'Glacier',
  description: 'Cool blues and cyan — a frosty take on dark mode',
  author: 'StdOut Team',
  version: '1.0.0',
  isBuiltIn: true,
  tags: ['dark', 'colorful'],
  colors: {
    bg: '#0A0E1A',
    bgSurface: '#111827',
    bgElevated: '#1E293B',
    bgHover: '#273548',
    border: '#334155',
    borderHover: '#475569',
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    accent: '#06B6D4',
    accentLight: '#22D3EE',
    accentBright: '#67E8F9',
    accentDim: 'rgba(6, 182, 212, 0.15)',
    accentGlow: 'rgba(6, 182, 212, 0.30)',
    accentBtn: '#0891B2',
    critical: '#EF4444',
    criticalDim: 'rgba(239, 68, 68, 0.15)',
    criticalGlow: 'rgba(239, 68, 68, 0.30)',
    high: '#F59E0B',
    highDim: 'rgba(245, 158, 11, 0.15)',
    highGlow: 'rgba(245, 158, 11, 0.30)',
    medium: '#EAB308',
    mediumDim: 'rgba(234, 179, 8, 0.12)',
    low: '#10B981',
    lowDim: 'rgba(16, 185, 129, 0.15)',
    lowGlow: 'rgba(16, 185, 129, 0.30)',
    resolved: '#6B7280',
    teal: '#14B8A6',
    tealDim: 'rgba(20, 184, 166, 0.15)',
    tealGlow: 'rgba(20, 184, 166, 0.30)',
    glassBg: 'rgba(17, 24, 39, 0.6)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },
};

// ============================================================================
// SKIN 3: SUNRISE — Warm light theme with orange/yellow accents
// ============================================================================
export const skinSunrise: SkinDefinition = {
  id: 'built-in-sunrise',
  name: 'Sunrise',
  description: 'Warm light theme with soft orange and yellow tones',
  author: 'StdOut Team',
  version: '1.0.0',
  isBuiltIn: true,
  tags: ['light', 'colorful'],
  colors: {
    bg: '#FFF7ED',
    bgSurface: '#FFFFFF',
    bgElevated: '#FFFBF5',
    bgHover: '#FFF4E6',
    border: '#FED7AA',
    borderHover: '#FDBA74',
    text: '#1C1917',
    textSecondary: '#57534E',
    textMuted: '#78716C',
    accent: '#EA580C',
    accentLight: '#F97316',
    accentBright: '#FB923C',
    accentDim: 'rgba(234, 88, 12, 0.10)',
    accentGlow: 'rgba(234, 88, 12, 0.20)',
    accentBtn: '#C2410C',
    critical: '#DC2626',
    criticalDim: 'rgba(220, 38, 38, 0.10)',
    criticalGlow: 'rgba(220, 38, 38, 0.20)',
    high: '#D97706',
    highDim: 'rgba(217, 119, 6, 0.10)',
    highGlow: 'rgba(217, 119, 6, 0.20)',
    medium: '#CA8A04',
    mediumDim: 'rgba(202, 138, 4, 0.10)',
    low: '#16A34A',
    lowDim: 'rgba(22, 163, 74, 0.10)',
    lowGlow: 'rgba(22, 163, 74, 0.20)',
    resolved: '#A8A29E',
    teal: '#0D9488',
    tealDim: 'rgba(13, 148, 136, 0.10)',
    tealGlow: 'rgba(13, 148, 136, 0.20)',
    glassBg: 'rgba(255, 255, 255, 0.7)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
  },
};

// ============================================================================
// SKIN 4: MIDNIGHT — Purple-tinted dark theme with violet accents
// ============================================================================
export const skinMidnight: SkinDefinition = {
  id: 'built-in-midnight',
  name: 'Midnight',
  description: 'Deep purples with violet accents — a moody alternative',
  author: 'StdOut Team',
  version: '1.0.0',
  isBuiltIn: true,
  tags: ['dark', 'colorful'],
  colors: {
    bg: '#0F0A1A',
    bgSurface: '#1A1229',
    bgElevated: '#251C3D',
    bgHover: '#2F2447',
    border: '#3D2E5A',
    borderHover: '#4C3A6F',
    text: '#F5F3FF',
    textSecondary: '#C4B5FD',
    textMuted: '#A78BFA',
    accent: '#8B5CF6',
    accentLight: '#A78BFA',
    accentBright: '#C4B5FD',
    accentDim: 'rgba(139, 92, 246, 0.15)',
    accentGlow: 'rgba(139, 92, 246, 0.30)',
    accentBtn: '#7C3AED',
    critical: '#F87171',
    criticalDim: 'rgba(248, 113, 113, 0.15)',
    criticalGlow: 'rgba(248, 113, 113, 0.30)',
    high: '#FBBF24',
    highDim: 'rgba(251, 191, 36, 0.15)',
    highGlow: 'rgba(251, 191, 36, 0.30)',
    medium: '#FCD34D',
    mediumDim: 'rgba(252, 211, 77, 0.12)',
    low: '#34D399',
    lowDim: 'rgba(52, 211, 153, 0.15)',
    lowGlow: 'rgba(52, 211, 153, 0.30)',
    resolved: '#6B7280',
    teal: '#2DD4BF',
    tealDim: 'rgba(45, 212, 191, 0.15)',
    tealGlow: 'rgba(45, 212, 191, 0.30)',
    glassBg: 'rgba(26, 18, 41, 0.6)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },
};

// ============================================================================
// SKIN 5: TERMINAL — High-contrast monochrome with green accents
// ============================================================================
export const skinTerminal: SkinDefinition = {
  id: 'built-in-terminal',
  name: 'Terminal',
  description: 'High-contrast monochrome with classic terminal green',
  author: 'StdOut Team',
  version: '1.0.0',
  isBuiltIn: true,
  tags: ['dark', 'high-contrast', 'minimal', 'retro'],
  colors: {
    bg: '#000000',
    bgSurface: '#0A0A0A',
    bgElevated: '#141414',
    bgHover: '#1A1A1A',
    border: '#2A2A2A',
    borderHover: '#3A3A3A',
    text: '#FFFFFF',
    textSecondary: '#B3B3B3',
    textMuted: '#808080',
    accent: '#00FF00',
    accentLight: '#33FF33',
    accentBright: '#66FF66',
    accentDim: 'rgba(0, 255, 0, 0.12)',
    accentGlow: 'rgba(0, 255, 0, 0.25)',
    accentBtn: '#00CC00',
    critical: '#FF0000',
    criticalDim: 'rgba(255, 0, 0, 0.12)',
    criticalGlow: 'rgba(255, 0, 0, 0.30)',
    high: '#FFAA00',
    highDim: 'rgba(255, 170, 0, 0.12)',
    highGlow: 'rgba(255, 170, 0, 0.30)',
    medium: '#FFFF00',
    mediumDim: 'rgba(255, 255, 0, 0.10)',
    low: '#00DD00',
    lowDim: 'rgba(0, 221, 0, 0.12)',
    lowGlow: 'rgba(0, 221, 0, 0.30)',
    resolved: '#666666',
    teal: '#00FFFF',
    tealDim: 'rgba(0, 255, 255, 0.12)',
    tealGlow: 'rgba(0, 255, 255, 0.25)',
    glassBg: 'rgba(10, 10, 10, 0.8)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
  },
};

// ============================================================================
// EXPORT ALL DEFAULT SKINS
// ============================================================================
export const defaultSkins: SkinDefinition[] = [
  skinObsidian,
  skinGlacier,
  skinSunrise,
  skinMidnight,
  skinTerminal,
];
