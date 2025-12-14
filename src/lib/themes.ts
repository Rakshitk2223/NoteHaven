// Theme Configuration System
// Add new themes here without breaking existing code

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
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
}

export const themes: Record<string, Theme> = {
  'zen-garden': {
    name: 'zen-garden',
    label: 'Zen Garden',
    description: 'Default calming theme with soft earth tones',
    colors: {
      light: {
        background: '40 33% 96%',
        foreground: '0 0% 15%',
        card: '40 33% 96%',
        cardForeground: '0 0% 15%',
        popover: '40 33% 96%',
        popoverForeground: '0 0% 15%',
        primary: '213 34% 37%',
        primaryForeground: '0 0% 100%',
        secondary: '0 0% 88%',
        secondaryForeground: '0 0% 15%',
        muted: '0 0% 88%',
        mutedForeground: '0 0% 45%',
        accent: '213 34% 37%',
        accentForeground: '0 0% 100%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '0 0% 88%',
        input: '0 0% 88%',
        ring: '213 34% 37%',
      },
      dark: {
        background: '213 20% 15%',
        foreground: '40 33% 90%',
        card: '213 20% 18%',
        cardForeground: '40 33% 90%',
        popover: '213 20% 18%',
        popoverForeground: '40 33% 90%',
        primary: '213 50% 65%',
        primaryForeground: '213 20% 15%',
        secondary: '213 15% 25%',
        secondaryForeground: '40 33% 90%',
        muted: '213 15% 25%',
        mutedForeground: '0 0% 60%',
        accent: '213 50% 65%',
        accentForeground: '213 20% 15%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '213 15% 25%',
        input: '213 15% 25%',
        ring: '213 50% 65%',
      }
    }
  },
  
  'ocean-breeze': {
    name: 'ocean-breeze',
    label: 'Ocean Breeze',
    description: 'Fresh blue and teal tones inspired by the sea',
    colors: {
      light: {
        background: '200 30% 96%',
        foreground: '200 20% 15%',
        card: '200 30% 96%',
        cardForeground: '200 20% 15%',
        popover: '200 30% 96%',
        popoverForeground: '200 20% 15%',
        primary: '195 85% 45%',
        primaryForeground: '0 0% 100%',
        secondary: '195 20% 85%',
        secondaryForeground: '200 20% 15%',
        muted: '195 20% 85%',
        mutedForeground: '200 15% 45%',
        accent: '175 60% 50%',
        accentForeground: '0 0% 100%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '195 20% 85%',
        input: '195 20% 85%',
        ring: '195 85% 45%',
      },
      dark: {
        background: '200 40% 12%',
        foreground: '200 30% 90%',
        card: '200 35% 16%',
        cardForeground: '200 30% 90%',
        popover: '200 35% 16%',
        popoverForeground: '200 30% 90%',
        primary: '195 85% 55%',
        primaryForeground: '200 40% 12%',
        secondary: '200 25% 22%',
        secondaryForeground: '200 30% 90%',
        muted: '200 25% 22%',
        mutedForeground: '200 20% 60%',
        accent: '175 60% 50%',
        accentForeground: '200 40% 12%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '200 25% 22%',
        input: '200 25% 22%',
        ring: '195 85% 55%',
      }
    }
  },

  'sunset-glow': {
    name: 'sunset-glow',
    label: 'Sunset Glow',
    description: 'Warm oranges and purples like a beautiful sunset',
    colors: {
      light: {
        background: '30 40% 96%',
        foreground: '15 25% 15%',
        card: '30 40% 96%',
        cardForeground: '15 25% 15%',
        popover: '30 40% 96%',
        popoverForeground: '15 25% 15%',
        primary: '25 85% 55%',
        primaryForeground: '0 0% 100%',
        secondary: '30 30% 85%',
        secondaryForeground: '15 25% 15%',
        muted: '30 30% 85%',
        mutedForeground: '15 20% 45%',
        accent: '280 60% 60%',
        accentForeground: '0 0% 100%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '30 30% 85%',
        input: '30 30% 85%',
        ring: '25 85% 55%',
      },
      dark: {
        background: '270 35% 12%',
        foreground: '30 40% 90%',
        card: '270 30% 16%',
        cardForeground: '30 40% 90%',
        popover: '270 30% 16%',
        popoverForeground: '30 40% 90%',
        primary: '25 85% 60%',
        primaryForeground: '270 35% 12%',
        secondary: '270 20% 22%',
        secondaryForeground: '30 40% 90%',
        muted: '270 20% 22%',
        mutedForeground: '270 15% 60%',
        accent: '280 60% 65%',
        accentForeground: '270 35% 12%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '270 20% 22%',
        input: '270 20% 22%',
        ring: '25 85% 60%',
      }
    }
  },

  'forest-mist': {
    name: 'forest-mist',
    label: 'Forest Mist',
    description: 'Earthy greens and natural tones',
    colors: {
      light: {
        background: '120 20% 96%',
        foreground: '120 15% 15%',
        card: '120 20% 96%',
        cardForeground: '120 15% 15%',
        popover: '120 20% 96%',
        popoverForeground: '120 15% 15%',
        primary: '140 50% 40%',
        primaryForeground: '0 0% 100%',
        secondary: '120 15% 85%',
        secondaryForeground: '120 15% 15%',
        muted: '120 15% 85%',
        mutedForeground: '120 10% 45%',
        accent: '95 45% 50%',
        accentForeground: '0 0% 100%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '120 15% 85%',
        input: '120 15% 85%',
        ring: '140 50% 40%',
      },
      dark: {
        background: '140 25% 12%',
        foreground: '120 20% 90%',
        card: '140 20% 16%',
        cardForeground: '120 20% 90%',
        popover: '140 20% 16%',
        popoverForeground: '120 20% 90%',
        primary: '140 50% 50%',
        primaryForeground: '140 25% 12%',
        secondary: '140 15% 22%',
        secondaryForeground: '120 20% 90%',
        muted: '140 15% 22%',
        mutedForeground: '140 10% 60%',
        accent: '95 45% 55%',
        accentForeground: '140 25% 12%',
        destructive: '0 84.2% 60.2%',
        destructiveForeground: '0 0% 100%',
        border: '140 15% 22%',
        input: '140 15% 22%',
        ring: '140 50% 50%',
      }
    }
  }
};

// Apply theme to the document
export function applyTheme(themeName: string, mode: 'light' | 'dark') {
  const theme = themes[themeName];
  if (!theme) return;

  const colors = theme.colors[mode];
  const root = document.documentElement;

  // Temporarily disable transitions for instant theme change
  root.style.setProperty('transition', 'none');
  
  // Force a reflow to ensure the transition disable takes effect
  void root.offsetHeight;

  // Apply all color changes at once
  Object.entries(colors).forEach(([key, value]) => {
    const cssVar = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(`--${cssVar}`, value);
  });

  // Re-enable transitions after a small delay
  setTimeout(() => {
    root.style.removeProperty('transition');
  }, 0);
}

// Get current theme from localStorage or default
export function getCurrentTheme(): string {
  return localStorage.getItem('app-theme') || 'zen-garden';
}

// Save theme to localStorage
export function saveTheme(themeName: string) {
  localStorage.setItem('app-theme', themeName);
}
