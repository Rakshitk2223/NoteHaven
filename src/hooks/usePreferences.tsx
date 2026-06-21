// PreferencesProvider — single source of truth for app preferences.
//
// On mount it applies the locally-cached prefs immediately (so the UI is correct
// from first paint), then loads the cross-device copy from Supabase and re-applies.
// `update(partial)` is the one mutation path: it merges, applies to the DOM, and
// persists (localStorage instantly + Supabase in the background).

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  getCachedPrefs,
  loadPreferences,
  savePreferences,
  applyPreferencesToDOM,
} from '@/lib/preferences';

interface PreferencesContextValue {
  prefs: AppPreferences;
  loading: boolean;
  update: (patch: Partial<AppPreferences>) => void;
  resetAppearance: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

// Appearance/accessibility keys that "Reset appearance" should restore.
const APPEARANCE_KEYS: (keyof AppPreferences)[] = [
  'accent', 'fontSize', 'radius', 'reducedMotion', 'backgroundEffects',
  'highContrast', 'underlineLinks', 'focusRings', 'dyslexiaFont',
];

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppPreferences>(() => getCachedPrefs());
  const [loading, setLoading] = useState(true);

  // Apply the cached prefs synchronously on first render to avoid a flash.
  useEffect(() => {
    applyPreferencesToDOM(prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Then hydrate from Supabase (cross-device) and re-apply if it differs.
  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((loaded) => {
      if (cancelled) return;
      setPrefs(loaded);
      applyPreferencesToDOM(loaded);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<AppPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      applyPreferencesToDOM(next);
      void savePreferences(next);
      return next;
    });
  }, []);

  const resetAppearance = useCallback(() => {
    setPrefs((prev) => {
      const next = { ...prev };
      for (const k of APPEARANCE_KEYS) (next as Record<string, unknown>)[k] = DEFAULT_PREFERENCES[k];
      applyPreferencesToDOM(next);
      void savePreferences(next);
      return next;
    });
  }, []);

  return (
    <PreferencesContext.Provider value={{ prefs, loading, update, resetAppearance }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within a PreferencesProvider');
  return ctx;
}
