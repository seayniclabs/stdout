// ============================================================================
// SKIN APPLICATION SYSTEM
// ============================================================================
// Applies a skin by injecting its CSS variables into the :root element.
// Called when:
// - User selects a skin in Settings
// - Page loads (applies saved user preference)
// - User imports a new skin
// ============================================================================

import type { SkinDefinition } from './default-skins';

/**
 * Apply a skin to the current page by setting CSS variables on :root
 */
export function applySkin(skin: SkinDefinition): void {
  const root = document.documentElement;

  // Apply color variables
  Object.entries(skin.colors).forEach(([key, value]) => {
    const cssVarName = camelToKebab(key);
    root.style.setProperty(`--${cssVarName}`, value);
  });

  // Apply typography if present
  if (skin.typography) {
    if (skin.typography.fontUi) {
      root.style.setProperty('--font-ui', skin.typography.fontUi);
    }
    if (skin.typography.fontMono) {
      root.style.setProperty('--font-mono', skin.typography.fontMono);
    }
  }

  // Apply spacing if present
  if (skin.spacing) {
    Object.entries(skin.spacing).forEach(([key, value]) => {
      if (value) {
        const cssVarName = camelToKebab(key);
        root.style.setProperty(`--${cssVarName}`, value);
      }
    });
  }

  // Apply shadows if present
  if (skin.shadows) {
    Object.entries(skin.shadows).forEach(([key, value]) => {
      if (value) {
        const cssVarName = camelToKebab(key);
        root.style.setProperty(`--${cssVarName}`, value);
      }
    });
  }

  // Apply effects if present
  if (skin.effects) {
    if (skin.effects.glassBlur) {
      root.style.setProperty('--glass-blur', skin.effects.glassBlur);
    }
  }

  // Store active skin ID in localStorage for persistence
  localStorage.setItem('stdout-active-skin', skin.id);
}

/**
 * Load and apply the user's saved skin preference on page load
 */
export function loadSavedSkin(defaultSkin: SkinDefinition, availableSkins: SkinDefinition[]): void {
  const savedSkinId = localStorage.getItem('stdout-active-skin');

  if (savedSkinId) {
    const skin = availableSkins.find(s => s.id === savedSkinId);
    if (skin) {
      applySkin(skin);
      return;
    }
  }

  // No saved preference or skin not found - apply default
  applySkin(defaultSkin);
}

/**
 * Convert camelCase to kebab-case for CSS variable names
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Reset to default skin
 */
export function resetToDefaultSkin(defaultSkin: SkinDefinition): void {
  applySkin(defaultSkin);
}

/**
 * Get currently active skin ID from localStorage
 */
export function getActiveSkinId(): string | null {
  return localStorage.getItem('stdout-active-skin');
}
