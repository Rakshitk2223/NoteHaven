import { Info, ExternalLink } from 'lucide-react';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

const APP_VERSION = '1.0.0';
const ENVIRONMENT = import.meta.env.PROD ? 'Production' : 'Development';

export function AboutSection() {
  return (
    <SettingsSection title="About" description="App information and resources." icon={Info}>
      <SettingRow label="Application">
        <span className="text-sm font-medium gradient-text-soft">NoteHaven</span>
      </SettingRow>
      <SettingRow label="Version">
        <span className="font-mono text-sm text-muted-foreground">v{APP_VERSION}</span>
      </SettingRow>
      <SettingRow label="Environment">
        <span className="text-sm text-muted-foreground">{ENVIRONMENT}</span>
      </SettingRow>
      <SettingRow label="WeebsList" description="Track your anime, manga, and more.">
        <a
          href="https://weebslist.netlify.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Open <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </SettingRow>
    </SettingsSection>
  );
}

export default AboutSection;
