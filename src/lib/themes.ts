// Theme Configuration System
// Three families (Aurora, Netflix, Prime), each with a light + dark mode.
// AURORA DARK is the default — the premium-SaaS look (deep charcoal canvas,
// electric indigo→cyan gradient accents, glassy glow). Netflix/Prime remain as
// selectable alternates. Values are HSL triplets so the shadcn token pipeline
// (`hsl(var(--x))` + Tailwind opacity modifiers) keeps working unchanged.

export interface Theme {
  name: string;
  label: string;
  description: string;
  colors: {
    light: ThemeColors;
    dark: ThemeColors;
  };
}

export interface ThemeColors {
  background: string;        // --canvas
  foreground: string;        // --text-1
  card: string;              // --surface-1
  cardForeground: string;
  popover: string;           // --surface-1 (floating, glass)
  popoverForeground: string;
  primary: string;           // --accent (brand)
  primaryForeground: string; // --accent-text
  secondary: string;         // --surface-2
  secondaryForeground: string;
  muted: string;             // --surface-3
  mutedForeground: string;   // --text-2 (secondary body)
  accent: string;            // shadcn hover-bg → --surface-2
  accentForeground: string;
  destructive: string;       // --danger
  destructiveForeground: string;
  border: string;
  input: string;             // --surface-3
  ring: string;              // focus
  // Extended design-system tokens (not part of base shadcn):
  borderStrong: string;      // --border-strong
  accentHover: string;       // --accent-hover
  text3: string;             // --text-3 (captions / faint)
  success: string;
  warning: string;
  // Aurora gradient/glow tokens:
  accent2: string;           // --accent-2 (gradient end / secondary accent)
  accent2Hover: string;      // --accent-2-hover
  glow: string;              // --glow (glow + ambient backdrop color)
}

export const themes: Record<string, Theme> = {
  'aurora': {
    name: 'aurora',
    label: 'Aurora',
    description: 'Deep charcoal canvas with an electric indigo→cyan gradient — premium and modern',
    colors: {
      // AURORA LIGHT
      light: {
        background: '228 39% 97%',
        foreground: '222 40% 11%',
        card: '0 0% 100%',
        cardForeground: '222 40% 11%',
        popover: '0 0% 100%',
        popoverForeground: '222 40% 11%',
        primary: '250 80% 60%',
        primaryForeground: '0 0% 100%',
        secondary: '225 40% 96%',
        secondaryForeground: '222 40% 11%',
        muted: '222 28% 92%',
        mutedForeground: '220 16% 40%',
        accent: '225 40% 96%',
        accentForeground: '222 40% 11%',
        destructive: '351 83% 56%',
        destructiveForeground: '0 0% 100%',
        border: '222 24% 89%',
        input: '222 24% 91%',
        ring: '250 80% 60%',
        borderStrong: '222 20% 80%',
        accentHover: '250 78% 54%',
        text3: '220 12% 52%',
        success: '158 68% 40%',
        warning: '36 92% 45%',
        accent2: '190 92% 42%',
        accent2Hover: '190 95% 36%',
        glow: '250 80% 60%',
      },
      // AURORA DARK — the default star. #0B0E14 canvas, indigo→cyan accent.
      dark: {
        background: '222 32% 7%',
        foreground: '213 31% 95%',
        card: '222 28% 10%',
        cardForeground: '213 31% 95%',
        popover: '223 30% 11%',
        popoverForeground: '213 31% 95%',
        primary: '250 89% 66%',
        primaryForeground: '0 0% 100%',
        secondary: '222 24% 14%',
        secondaryForeground: '213 31% 95%',
        muted: '222 22% 17%',
        mutedForeground: '217 18% 65%',
        accent: '222 24% 14%',
        accentForeground: '213 31% 95%',
        destructive: '351 89% 62%',
        destructiveForeground: '0 0% 100%',
        border: '220 22% 16%',
        input: '222 22% 17%',
        ring: '250 89% 66%',
        borderStrong: '220 18% 27%',
        accentHover: '250 90% 72%',
        text3: '218 14% 46%',
        success: '158 72% 52%',
        warning: '38 95% 62%',
        accent2: '189 94% 55%',
        accent2Hover: '189 95% 64%',
        glow: '250 89% 66%',
      }
    }
  },

  'netflix': {
    name: 'netflix',
    label: 'Netflix',
    description: 'Near-black cinematic canvas, signature red as a rare accent',
    colors: {
      // NETFLIX LIGHT — secondary mode: clean, uncramped.
      light: {
        background: '0 0% 96%',       // #f4f4f4
        foreground: '0 0% 8%',        // #141414
        card: '0 0% 100%',            // #ffffff
        cardForeground: '0 0% 8%',
        popover: '0 0% 100%',
        popoverForeground: '0 0% 8%',
        primary: '357 92% 47%',       // #E50914
        primaryForeground: '0 0% 100%',
        secondary: '0 0% 98%',        // #fafafa
        secondaryForeground: '0 0% 8%',
        muted: '0 0% 93%',            // #eeeeee
        mutedForeground: '0 0% 30%',  // #4d4d4d (text-2)
        accent: '0 0% 98%',
        accentForeground: '0 0% 8%',
        destructive: '357 92% 47%',
        destructiveForeground: '0 0% 100%',
        border: '0 0% 92%',
        input: '0 0% 93%',
        ring: '357 92% 47%',
        borderStrong: '0 0% 86%',
        accentHover: '357 92% 40%',   // #c40812
        text3: '0 0% 54%',            // #8a8a8a
        success: '141 68% 37%',       // #1e9e4a
        warning: '43 89% 38%',        // #b8860b
        accent2: '16 90% 50%',        // warm orange — gradient end
        accent2Hover: '16 90% 45%',
        glow: '357 92% 47%',          // signature red glow
      },
      // NETFLIX DARK — the design star. #141414 canvas, #E50914 accent.
      dark: {
        background: '0 0% 8%',        // #141414
        foreground: '0 0% 100%',      // #ffffff (text-1)
        card: '0 0% 11%',             // #1b1b1b (surface-1)
        cardForeground: '0 0% 100%',
        popover: '0 0% 11%',
        popoverForeground: '0 0% 100%',
        primary: '357 92% 47%',       // #E50914
        primaryForeground: '0 0% 100%',
        secondary: '0 0% 14%',        // #232323 (surface-2)
        secondaryForeground: '0 0% 100%',
        muted: '0 0% 17%',            // #2b2b2b (surface-3)
        mutedForeground: '0 0% 70%',  // #b3b3b3 (text-2)
        accent: '0 0% 14%',
        accentForeground: '0 0% 100%',
        destructive: '357 92% 47%',
        destructiveForeground: '0 0% 100%',
        border: '0 0% 16%',           // ≈ rgba(255,255,255,0.08) over canvas
        input: '0 0% 17%',
        ring: '357 92% 47%',
        borderStrong: '0 0% 21%',     // ≈ rgba(255,255,255,0.14)
        accentHover: '357 93% 52%',   // #f6121d
        text3: '0 0% 43%',            // #6e6e6e
        success: '135 62% 55%',       // #46d369
        warning: '44 82% 50%',        // #e8b219
        accent2: '16 90% 56%',        // warm orange — gradient end
        accent2Hover: '16 92% 62%',
        glow: '357 92% 47%',          // signature red glow
      }
    }
  },

  'prime': {
    name: 'prime',
    label: 'Prime',
    description: 'Slate-navy canvas with cyan-blue accent — a different premium product',
    colors: {
      // PRIME LIGHT
      light: {
        background: '210 18% 96%',    // #f2f4f6
        foreground: '208 33% 9%',     // #0F171E
        card: '0 0% 100%',
        cardForeground: '208 33% 9%',
        popover: '0 0% 100%',
        popoverForeground: '208 33% 9%',
        primary: '195 100% 33%',      // #007fa8
        primaryForeground: '0 0% 100%',
        secondary: '210 17% 99%',     // #fafbfc
        secondaryForeground: '208 33% 9%',
        muted: '210 21% 95%',         // #eef1f4
        mutedForeground: '207 17% 32%', // #44535f (text-2)
        accent: '210 17% 99%',
        accentForeground: '208 33% 9%',
        destructive: '358 67% 54%',   // #d83a3f
        destructiveForeground: '0 0% 100%',
        border: '210 16% 90%',
        input: '210 21% 95%',
        ring: '195 100% 33%',
        borderStrong: '210 16% 84%',
        accentHover: '197 100% 27%',  // #00638a
        text3: '208 14% 58%',         // #8595a3
        success: '156 69% 37%',       // #1d9e6b
        warning: '36 83% 42%',        // #c47d12
        accent2: '165 75% 38%',       // teal — gradient end
        accent2Hover: '165 78% 32%',
        glow: '195 100% 33%',         // cyan glow
      },
      // PRIME DARK
      dark: {
        background: '208 33% 9%',     // #0F171E
        foreground: '0 0% 100%',
        card: '211 29% 14%',          // #1A242F (surface-1)
        cardForeground: '0 0% 100%',
        popover: '211 29% 14%',
        popoverForeground: '0 0% 100%',
        primary: '195 100% 44%',      // #00A8E1
        primaryForeground: '200 100% 5%', // #001018 (dark text on bright cyan)
        secondary: '213 28% 19%',     // #232F3E (surface-2)
        secondaryForeground: '0 0% 100%',
        muted: '211 26% 23%',         // #2b3a4a (surface-3)
        mutedForeground: '210 18% 72%', // #aab7c4 (text-2)
        accent: '213 28% 19%',
        accentForeground: '0 0% 100%',
        destructive: '358 100% 68%',  // #ff5a5f
        destructiveForeground: '0 0% 100%',
        border: '210 22% 22%',
        input: '211 26% 23%',
        ring: '195 100% 44%',
        borderStrong: '210 22% 32%',
        accentHover: '195 91% 54%',   // #1ec0f5
        text3: '209 13% 48%',         // #6b7c8c
        success: '157 64% 47%',       // #2bc48a
        warning: '37 86% 59%',        // #f0a93b
        accent2: '165 80% 52%',       // teal — gradient end
        accent2Hover: '165 82% 60%',
        glow: '195 100% 44%',         // cyan glow
      }
    }
  }
};

// Apply theme to the document by writing CSS custom properties.
export function applyTheme(themeName: string, mode: 'light' | 'dark') {
  const theme = themes[themeName] || themes['netflix'];
  if (!theme) return;

  const colors = theme.colors[mode];
  const root = document.documentElement;

  // Temporarily disable transitions for instant theme change
  root.style.setProperty('transition', 'none');
  void root.offsetHeight; // force reflow

  // Map known camelCase keys → kebab CSS vars. A few need explicit handling
  // because the camelCase→kebab regex doesn't insert a dash before digits.
  const explicit: Record<string, string> = {
    text3: '--text-3',
    accent2: '--accent-2',
    accent2Hover: '--accent-2-hover',
  };
  Object.entries(colors).forEach(([key, value]) => {
    if (explicit[key]) {
      root.style.setProperty(explicit[key], value);
      return;
    }
    const cssVar = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(`--${cssVar}`, value);
  });

  // Reskin the sidebar from the active theme's tokens (surface-2 hover, accent active).
  const sidebar: Record<string, string> = {
    'sidebar-background': colors.background,
    'sidebar-foreground': colors.foreground,
    'sidebar-primary': colors.primary,
    'sidebar-primary-foreground': colors.primaryForeground,
    'sidebar-accent': colors.secondary,
    'sidebar-accent-foreground': colors.foreground,
    'sidebar-border': colors.border,
    'sidebar-ring': colors.ring,
  };
  Object.entries(sidebar).forEach(([cssVar, value]) => {
    root.style.setProperty(`--${cssVar}`, value);
  });

  // Persist the resolved data-theme for any attribute-based styling.
  root.setAttribute('data-theme', `${themeName}-${mode}`);

  setTimeout(() => {
    root.style.removeProperty('transition');
  }, 0);
}

// Migrate any legacy theme name (zen-garden, ocean-breeze, …) to the new default.
const VALID_THEMES = new Set(['aurora', 'netflix', 'prime']);

export function getCurrentTheme(): string {
  const saved = localStorage.getItem('app-theme');
  return saved && VALID_THEMES.has(saved) ? saved : 'aurora';
}

export function saveTheme(themeName: string) {
  localStorage.setItem('app-theme', themeName);
}
