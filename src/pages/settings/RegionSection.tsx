import { Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePreferences } from '@/hooks/usePreferences';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

const CURRENCIES = [
  { value: 'INR', label: 'Indian Rupee (₹)' },
  { value: 'USD', label: 'US Dollar ($)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'GBP', label: 'British Pound (£)' },
  { value: 'JPY', label: 'Japanese Yen (¥)' },
  { value: 'AUD', label: 'Australian Dollar (A$)' },
  { value: 'CAD', label: 'Canadian Dollar (C$)' },
  { value: 'SGD', label: 'Singapore Dollar (S$)' },
  { value: 'AED', label: 'UAE Dirham (د.إ)' },
  { value: 'CHF', label: 'Swiss Franc (CHF)' },
];

const LOCALES = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'ja-JP', label: 'Japanese (Japan)' },
];

export function RegionSection() {
  const { prefs, update } = usePreferences();

  let preview = '';
  try {
    preview = new Intl.NumberFormat(prefs.locale, { style: 'currency', currency: prefs.currency }).format(1234.5);
  } catch { preview = '—'; }

  return (
    <SettingsSection
      title="Language & region"
      description="How money and numbers are formatted across the app."
      icon={Globe}
    >
      <SettingRow label="Currency" description="Used in the Money Ledger, subscriptions, and dashboard.">
        <Select value={prefs.currency} onValueChange={(v) => update({ currency: v })}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Number & date format" description="Regional formatting for amounts and grouping.">
        <Select value={prefs.locale} onValueChange={(v) => update({ locale: v })}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Preview" description="A sample amount in your chosen format.">
        <span className="font-mono text-sm font-medium text-foreground">{preview}</span>
      </SettingRow>
    </SettingsSection>
  );
}

export default RegionSection;
