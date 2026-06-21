import { useState } from 'react';
import { Palette, Sun, Moon, Monitor, RotateCcw, Check, Type, Square } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { themes, getCurrentTheme, saveTheme, applyTheme } from '@/lib/themes';
import { type Mode, getStoredMode, setStoredMode, resolveMode, applyPreferencesToDOM } from '@/lib/preferences';
import { usePreferences } from '@/hooks/usePreferences';
import { SettingsSection, SettingRow, Segmented } from '@/components/settings/primitives';

const ACCENTS = [
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Pink', hex: '#EC4899' },
];

export function AppearanceSection() {
  const { prefs, update, resetAppearance } = usePreferences();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>(() => getStoredMode());
  const [colorTheme, setColorTheme] = useState(() => getCurrentTheme());

  // Re-assert accent/radius after any applyTheme (which rewrites --primary etc.).
  const applyAll = (themeName: string, m: Mode) => {
    const resolved = resolveMode(m);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    applyTheme(themeName, resolved);
    applyPreferencesToDOM(prefs);
  };

  const changeMode = (m: Mode) => { setMode(m); setStoredMode(m); applyAll(colorTheme, m); };

  const changeTheme = (name: string) => {
    setColorTheme(name);
    saveTheme(name);
    applyAll(name, mode);
    toast({ title: 'Theme changed', description: themes[name]?.label });
  };

  const setAccent = (hex: string) => update({ accent: hex });
  const clearAccent = () => {
    update({ accent: null });
    // applyPreferencesToDOM removed our --primary override; restore the theme's.
    applyTheme(colorTheme, resolveMode(mode));
  };

  const resetAll = () => {
    resetAppearance();
    setMode('dark');
    setColorTheme('aurora');
    setStoredMode('dark');
    saveTheme('aurora');
    document.documentElement.classList.add('dark');
    applyTheme('aurora', 'dark');
    toast({ title: 'Appearance reset', description: 'Aurora dark restored' });
  };

  return (
    <SettingsSection
      title="Appearance"
      description="Theme, colors, and how dense the interface feels."
      icon={Palette}
      action={
        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw className="h-4 w-4 mr-2" /> Reset
        </Button>
      }
    >
      <SettingRow label="Color theme" description="The overall palette family." stacked>
        <Select value={colorTheme} onValueChange={changeTheme}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.values(themes).map((t) => {
              const s = t.colors[resolveMode(mode)];
              const dots = [s.background, s.card, s.primary];
              return (
                <SelectItem key={t.name} value={t.name}>
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-1">
                      {dots.map((c, i) => (
                        <span key={i} className="h-4 w-4 rounded-full ring-1 ring-border" style={{ backgroundColor: `hsl(${c})` }} />
                      ))}
                    </div>
                    <div>
                      <p className="font-medium">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Mode" description="Light, dark, or follow your system.">
        <Segmented<Mode>
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Monitor },
          ]}
        />
      </SettingRow>

      <SettingRow label="Accent color" description="Overrides the theme's brand color across buttons, links, and highlights." stacked>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((a) => {
            const active = prefs.accent?.toLowerCase() === a.hex.toLowerCase();
            return (
              <button
                key={a.hex}
                type="button"
                title={a.name}
                onClick={() => setAccent(a.hex)}
                className={cn(
                  'relative h-8 w-8 rounded-full ring-1 ring-border transition-transform hover:scale-110',
                  active && 'ring-2 ring-offset-2 ring-offset-background ring-foreground',
                )}
                style={{ backgroundColor: a.hex }}
              >
                {active && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />}
              </button>
            );
          })}
          <label
            className="inline-flex h-8 items-center gap-2 rounded-full border border-dashed border-border px-3 text-xs text-muted-foreground cursor-pointer hover:bg-muted/50"
            title="Custom color"
          >
            <input
              type="color"
              value={prefs.accent ?? '#6366F1'}
              onChange={(e) => setAccent(e.target.value)}
              className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
            />
            Custom
          </label>
          {prefs.accent && (
            <Button variant="ghost" size="sm" onClick={clearAccent} className="h-8 text-xs">Default</Button>
          )}
        </div>
      </SettingRow>

      <SettingRow label="Text size" description="Scales text and spacing across the whole app.">
        <Segmented
          value={prefs.fontSize}
          onChange={(v) => update({ fontSize: v })}
          options={[
            { value: 'sm', label: <span className="text-xs">A</span>, icon: undefined },
            { value: 'md', label: <span className="text-sm">A</span> },
            { value: 'lg', label: <span className="text-base">A</span> },
          ]}
        />
      </SettingRow>

      <SettingRow label="Corner roundness" description="How rounded cards, buttons, and inputs appear.">
        <Segmented
          value={prefs.radius}
          onChange={(v) => update({ radius: v })}
          options={[
            { value: 'sharp', label: 'Sharp', icon: Square },
            { value: 'default', label: 'Default' },
            { value: 'rounded', label: 'Rounded' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Reduce motion" description="Minimize animations and transitions." htmlFor="pref-reduced-motion">
        <Switch id="pref-reduced-motion" checked={prefs.reducedMotion} onCheckedChange={(v) => update({ reducedMotion: v })} />
      </SettingRow>

      <SettingRow label="Background effects" description="The ambient drifting glow behind the app." htmlFor="pref-bg-effects">
        <Switch id="pref-bg-effects" checked={prefs.backgroundEffects} onCheckedChange={(v) => update({ backgroundEffects: v })} />
      </SettingRow>
    </SettingsSection>
  );
}

export default AppearanceSection;
