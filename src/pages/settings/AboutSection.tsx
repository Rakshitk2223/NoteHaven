import { useState } from 'react';
import { Info, ExternalLink, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';
import { checkForUpdateNow } from '@/lib/app-update';

// The running build (vite.config.ts `define`). The version goes up by one on every push to main.
const APP_VERSION = __APP_VERSION__;
const BUILT = (() => { try { return format(new Date(__APP_BUILT_AT__), 'd MMM yyyy, HH:mm'); } catch { return ''; } })();
const ENVIRONMENT = import.meta.env.PROD ? 'Production' : 'Development';

export function AboutSection() {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdateNow();
      toast({
        title: r === 'updating' ? 'New version found' : r === 'latest' ? `You’re on the latest version (v${APP_VERSION})` : 'Can’t check here',
        description: r === 'updating' ? 'The app reloads into it in a moment.' : r === 'unavailable' ? 'Update checks run in the installed or deployed app.' : undefined,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsSection title="About" description="App information and resources." icon={Info}>
      <SettingRow label="Application">
        <span className="text-sm font-medium gradient-text-soft">NoteHaven</span>
      </SettingRow>
      <SettingRow label="Version" description={`Build ${__APP_COMMIT__}${BUILT ? ` · ${BUILT}` : ''}`}>
        <span className="font-mono text-sm text-foreground">v{APP_VERSION}</span>
      </SettingRow>
      <SettingRow label="Updates" description="The app updates itself; this checks right now.">
        <Button variant="outline" size="sm" className="h-9" onClick={() => void check()} disabled={checking}>
          <RefreshCw className={checking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
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
