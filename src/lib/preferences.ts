// App preferences store.
//
// One JSON blob of user-tunable settings, persisted two ways:
//   * localStorage  — synchronous, offline-safe, read on first paint (no FOUC).
//   * user_preferences (Supabase) — cross-device sync, mirrored on every save.
//
// Light/dark *mode* and the color *theme family* keep their own legacy keys
// ('theme' / 'app-theme', see lib/themes.ts) so the index.html inline script can
// apply them before the bundle loads. Everything else lives here.
//
// applyPreferencesToDOM() writes CSS custom properties + root classes so the
// values actually take effect app-wide; getCachedPrefs() is a synchronous read
// for non-React call sites (e.g. formatCurrency in lib/ledger.ts).

import { supabase } from '@/integrations/supabase/client';
import { applyTheme, getCurrentTheme } from '@/lib/themes';

export type Mode = 'light' | 'dark' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type Radius = 'sharp' | 'default' | 'rounded';

export interface AppPreferences {
  // Appearance
  accent: string | null;          // hex like "#6366F1"; null = use theme default
  fontSize: FontSize;
  radius: Radius;
  reducedMotion: boolean;
  backgroundEffects: boolean;     // the ambient Aurora orbs
  // Accessibility
  highContrast: boolean;
  underlineLinks: boolean;
  focusRings: boolean;            // always show focus outlines (not just keyboard)
  dyslexiaFont: boolean;
  // Behavior & defaults
  defaultLanding: string;         // route to open after login
  // Region
  currency: string;               // ISO 4217, e.g. "INR"
  locale: string;                 // BCP-47, e.g. "en-IN"
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  accent: null,
  fontSize: 'md',
  radius: 'default',
  reducedMotion: false,
  backgroundEffects: true,
  highContrast: false,
  underlineLinks: false,
  focusRings: false,
  dyslexiaFont: false,
  defaultLanding: '/dashboard',
  currency: 'INR',
  locale: 'en-IN',
};

const LS_KEY = 'app_preferences';
const PREFERENCE_KEY = 'app_preferences';

// Module-level cache so synchronous callers (formatCurrency) get current values
// without re-reading localStorage each time.
let cache: AppPreferences | null = null;

function readLocal(): AppPreferences {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<AppPreferences>) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFERENCES };
}

/** Synchronous best-effort read (cached). Safe for non-React, hot-path callers. */
export function getCachedPrefs(): AppPreferences {
  if (!cache) cache = readLocal();
  return cache;
}

function writeLocal(prefs: AppPreferences) {
  cache = prefs;
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

/** Load from Supabase, falling back to (and merging over) the local copy. */
export async function loadPreferences(): Promise<AppPreferences> {
  const local = readLocal();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return local;
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_value')
      .eq('user_id', user.id)
      .eq('preference_key', PREFERENCE_KEY)
      .single();
    if (error || !data) return local;
    const remote = data.preference_value as unknown as Partial<AppPreferences>;
    const merged = { ...DEFAULT_PREFERENCES, ...local, ...remote };
    writeLocal(merged);
    return merged;
  } catch {
    return local;
  }
}

/** Persist locally (instant) and upsert to Supabase (cross-device, best-effort). */
export async function savePreferences(prefs: AppPreferences): Promise<void> {
  writeLocal(prefs);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('user_preferences')
      .upsert({
        user_id: user.id,
        preference_key: PREFERENCE_KEY,
        preference_value: JSON.parse(JSON.stringify(prefs)),
      }, { onConflict: 'user_id,preference_key' });
  } catch (e) {
    console.error('Failed to sync preferences:', e);
  }
}

// ---------------------------------------------------------------------------
// Mode (light / dark / system) — stored in the legacy 'theme' key.
// ---------------------------------------------------------------------------

export function getStoredMode(): Mode {
  try {
    const m = localStorage.getItem('theme');
    if (m === 'light' || m === 'dark' || m === 'system') return m;
  } catch { /* ignore */ }
  return 'dark';
}

export function setStoredMode(mode: Mode) {
  try { localStorage.setItem('theme', mode); } catch { /* ignore */ }
}

/** Resolve 'system' against the OS preference; pass-through for explicit modes. */
export function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode === 'system') {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch { return 'dark'; }
  }
  return mode;
}

// ---------------------------------------------------------------------------
// DOM application — make the preferences actually take effect.
// ---------------------------------------------------------------------------

const RADIUS_SCALES: Record<Radius, Record<string, string>> = {
  sharp:   { '--radius-sm': '4px',  '--radius-md': '7px',  '--radius-lg': '10px', '--radius-xl': '14px', '--radius': '7px' },
  default: { '--radius-sm': '9px',  '--radius-md': '14px', '--radius-lg': '18px', '--radius-xl': '24px', '--radius': '14px' },
  rounded: { '--radius-sm': '14px', '--radius-md': '20px', '--radius-lg': '26px', '--radius-xl': '34px', '--radius': '20px' },
};

const FONT_SIZE_ROOT: Record<FontSize, string> = {
  sm: '87.5%',  // 14px base
  md: '100%',   // 16px base
  lg: '112.5%', // 18px base
};

/** Convert "#rrggbb" → "h s% l%" (the HSL-triplet form the shadcn tokens expect). */
export function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Write all CSS variables + root classes derived from the preferences. */
export function applyPreferencesToDOM(prefs: AppPreferences) {
  const root = document.documentElement;

  // Accent — override the brand/primary tokens (theme handles the rest).
  const accentHsl = prefs.accent ? hexToHslTriplet(prefs.accent) : null;
  if (accentHsl) {
    for (const v of ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring', '--glow']) {
      root.style.setProperty(v, accentHsl);
    }
  } else {
    // No custom accent: re-apply the active theme's brand tokens. Simply removing
    // the overrides would fall back to the stylesheet defaults and visibly change
    // the theme (e.g. Netflix red → Aurora indigo) whenever an unrelated pref is
    // toggled, since applyTheme writes --primary/--ring/--glow as inline styles.
    applyTheme(getCurrentTheme(), resolveMode(getStoredMode()));
  }

  // Border radius scale.
  if (prefs.radius === 'default') {
    for (const v of Object.keys(RADIUS_SCALES.default)) root.style.removeProperty(v);
  } else {
    Object.entries(RADIUS_SCALES[prefs.radius]).forEach(([k, v]) => root.style.setProperty(k, v));
  }

  // Base font size (scales every rem in the app).
  if (prefs.fontSize === 'md') root.style.removeProperty('font-size');
  else root.style.fontSize = FONT_SIZE_ROOT[prefs.fontSize];

  // Boolean class toggles consumed by index.css.
  root.classList.toggle('reduce-motion', prefs.reducedMotion);
  root.classList.toggle('high-contrast', prefs.highContrast);
  root.classList.toggle('underline-links', prefs.underlineLinks);
  root.classList.toggle('always-focus', prefs.focusRings);
  root.classList.toggle('dyslexia-font', prefs.dyslexiaFont);
}
