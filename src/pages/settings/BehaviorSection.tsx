import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePreferences } from '@/hooks/usePreferences';
import { SettingsSection, SettingRow, Segmented } from '@/components/settings/primitives';

const LANDING_PAGES = [
  { value: '/dashboard', label: 'Dashboard' },
  { value: '/calendar', label: 'Calendar' },
  { value: '/notes', label: 'Notes' },
  { value: '/tasks', label: 'Tasks' },
  { value: '/media', label: 'Media' },
  { value: '/library', label: 'Library' },
  { value: '/ledger', label: 'Money Ledger' },
  { value: '/subscriptions', label: 'Subscriptions' },
  { value: '/birthdays', label: 'Birthdays' },
  { value: '/vault', label: 'Vault' },
];

const MEDIA_SORTS = [
  { value: 'updated_at', label: 'Recently updated' },
  { value: 'created_at', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'rating', label: 'My rating' },
  { value: 'ext_rating', label: 'Source rating' },
  { value: 'pct_complete', label: 'Progress' },
];

// Small helper so a localStorage-backed control reflects + persists its value.
function useLocalPref<T extends string>(key: string, fallback: T, valid: (v: string) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      if (v && valid(v)) return v;
    } catch { /* ignore */ }
    return fallback;
  });
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };
  return [value, set] as const;
}

export function BehaviorSection() {
  const { prefs, update } = usePreferences();

  const [mediaView, setMediaView] = useLocalPref<'grid' | 'list'>(
    'mediaTrackerViewMode', 'grid', (v): v is 'grid' | 'list' => v === 'grid' || v === 'list');
  const [mediaSort, setMediaSort] = useLocalPref<string>(
    'mediaTrackerSortBy', 'updated_at', (v): v is string => MEDIA_SORTS.some((s) => s.value === v));
  const [vaultView, setVaultView] = useLocalPref<'grid' | 'list'>(
    'vault-view', 'grid', (v): v is 'grid' | 'list' => v === 'grid' || v === 'list');
  const [libraryTab, setLibraryTab] = useLocalPref<'prompts' | 'snippets'>(
    'library-active-tab', 'prompts', (v): v is 'prompts' | 'snippets' => v === 'prompts' || v === 'snippets');

  return (
    <SettingsSection
      title="Behavior & defaults"
      description="What opens first, and the default view for each section."
      icon={SlidersHorizontal}
    >
      <SettingRow label="Start page" description="Where you land after signing in.">
        <Select value={prefs.defaultLanding} onValueChange={(v) => update({ defaultLanding: v })}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LANDING_PAGES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Media — default view">
        <Segmented value={mediaView} onChange={setMediaView}
          options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
      </SettingRow>

      <SettingRow label="Media — default sort">
        <Select value={mediaSort} onValueChange={setMediaSort}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEDIA_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Vault — default view">
        <Segmented value={vaultView} onChange={setVaultView}
          options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
      </SettingRow>

      <SettingRow label="Library — default tab">
        <Segmented value={libraryTab} onChange={setLibraryTab}
          options={[{ value: 'prompts', label: 'Prompts' }, { value: 'snippets', label: 'Snippets' }]} />
      </SettingRow>
    </SettingsSection>
  );
}

export default BehaviorSection;
