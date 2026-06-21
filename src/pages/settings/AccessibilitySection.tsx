import { Accessibility } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { usePreferences } from '@/hooks/usePreferences';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

export function AccessibilitySection() {
  const { prefs, update } = usePreferences();
  return (
    <SettingsSection
      title="Accessibility"
      description="Make the interface easier to read and operate."
      icon={Accessibility}
    >
      <SettingRow label="High contrast" description="Stronger borders and brighter text for better legibility." htmlFor="a11y-contrast">
        <Switch id="a11y-contrast" checked={prefs.highContrast} onCheckedChange={(v) => update({ highContrast: v })} />
      </SettingRow>
      <SettingRow label="Underline links" description="Always underline links, not just on hover." htmlFor="a11y-underline">
        <Switch id="a11y-underline" checked={prefs.underlineLinks} onCheckedChange={(v) => update({ underlineLinks: v })} />
      </SettingRow>
      <SettingRow label="Always show focus rings" description="Keep keyboard focus outlines visible for every element." htmlFor="a11y-focus">
        <Switch id="a11y-focus" checked={prefs.focusRings} onCheckedChange={(v) => update({ focusRings: v })} />
      </SettingRow>
      <SettingRow label="Readable font" description="Switch to a wider, evenly-spaced font for easier reading." htmlFor="a11y-dyslexia">
        <Switch id="a11y-dyslexia" checked={prefs.dyslexiaFont} onCheckedChange={(v) => update({ dyslexiaFont: v })} />
      </SettingRow>
      <SettingRow label="Reduce motion" description="Minimize animations and transitions (also in Appearance)." htmlFor="a11y-motion">
        <Switch id="a11y-motion" checked={prefs.reducedMotion} onCheckedChange={(v) => update({ reducedMotion: v })} />
      </SettingRow>
    </SettingsSection>
  );
}

export default AccessibilitySection;
