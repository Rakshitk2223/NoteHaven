import { Keyboard, Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-secondary/70 px-1.5 text-xs font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [mod, 'K'], label: 'Open the command palette' },
  { keys: [mod, 'Enter'], label: 'Save (within editors that support it)' },
  { keys: ['Esc'], label: 'Close the open dialog or palette' },
];

export function KeyboardSection() {
  const openPalette = () => window.dispatchEvent(new Event('open-command-palette'));

  return (
    <SettingsSection
      title="Keyboard"
      description="Shortcuts for moving around faster."
      icon={Keyboard}
      action={<Button variant="secondary" size="sm" onClick={openPalette}><Command className="h-4 w-4 mr-2" /> Open palette</Button>}
    >
      {SHORTCUTS.map((s) => (
        <SettingRow key={s.label} label={s.label}>
          <span className="flex items-center gap-1">
            {s.keys.map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
        </SettingRow>
      ))}
      <SettingRow label="Tip" description="The command palette is the fastest way to jump to any page or run an action." />
    </SettingsSection>
  );
}

export default KeyboardSection;
