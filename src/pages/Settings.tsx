import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Settings as SettingsIcon, Search, User, Palette, Accessibility,
  SlidersHorizontal, Globe, LayoutDashboard, PanelLeft, Keyboard, Lock, Database, Info, Activity,
} from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { Input } from '@/components/ui/input';
import { FadeIn } from '@/components/ui/motion';
import { cn } from '@/lib/utils';
import { useProfile, initialsFor } from '@/pages/settings/useProfile';

import { AccountSection } from '@/pages/settings/AccountSection';
import { AppearanceSection } from '@/pages/settings/AppearanceSection';
import { AccessibilitySection } from '@/pages/settings/AccessibilitySection';
import { BehaviorSection } from '@/pages/settings/BehaviorSection';
import { RegionSection } from '@/pages/settings/RegionSection';
import { DashboardSection } from '@/pages/settings/DashboardSection';
import { SidebarSection } from '@/pages/settings/SidebarSection';
import { KeyboardSection } from '@/pages/settings/KeyboardSection';
import { SecuritySection } from '@/pages/settings/SecuritySection';
import { DataSection } from '@/pages/settings/DataSection';
import { AboutSection } from '@/pages/settings/AboutSection';
import { SyncActivitySection } from '@/pages/settings/SyncActivitySection';

interface SectionDef {
  id: string;
  label: string;
  icon: React.ElementType;
  keywords: string;
  Component: React.ComponentType;
}

const SECTIONS: SectionDef[] = [
  { id: 'account', label: 'Account', icon: User, keywords: 'profile avatar name email sign out delete danger stats', Component: AccountSection },
  { id: 'appearance', label: 'Appearance', icon: Palette, keywords: 'theme dark light mode accent color font size radius motion background glow', Component: AppearanceSection },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility, keywords: 'contrast underline focus dyslexia readable motion', Component: AccessibilitySection },
  { id: 'behavior', label: 'Behavior', icon: SlidersHorizontal, keywords: 'defaults start page landing view sort media vault library', Component: BehaviorSection },
  { id: 'region', label: 'Language & region', icon: Globe, keywords: 'currency locale number date format money', Component: RegionSection },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: 'widgets layout customize', Component: DashboardSection },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft, keywords: 'navigation order reorder collapse rail', Component: SidebarSection },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard, keywords: 'shortcuts command palette keys', Component: KeyboardSection },
  { id: 'security', label: 'Security', icon: Lock, keywords: 'password change', Component: SecuritySection },
  { id: 'data', label: 'Data', icon: Database, keywords: 'export import backup cache storage vault restore', Component: DataSection },
  { id: 'sync', label: 'Sync activity', icon: Activity, keywords: 'refresh media library background status updated failed sync metadata', Component: SyncActivitySection },
  { id: 'about', label: 'About', icon: Info, keywords: 'version environment links weebslist', Component: AboutSection },
];

const Settings = () => {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const { profile } = useProfile();

  const activeId = SECTIONS.some((s) => s.id === params.get('section')) ? params.get('section')! : 'account';
  const active = SECTIONS.find((s) => s.id === activeId)!;
  const ActiveComponent = active.Component;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.keywords.includes(q));
  }, [query]);

  const select = (id: string) => setParams({ section: id }, { replace: true });

  return (
    <PageShell title="Settings" icon={SettingsIcon} subtitle="Manage your account & preferences">
      <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 max-w-6xl">
        {/* Nav rail */}
        <nav className="lg:w-60 flex-shrink-0 lg:sticky lg:top-6 lg:self-start space-y-4">
          {/* Identity (desktop) */}
          <div className="hidden lg:flex items-center gap-3 rounded-2xl zen-card p-3">
            <div className="h-10 w-10 flex-shrink-0 rounded-xl overflow-hidden ring-1 ring-border bg-gradient-brand-soft">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm font-bold text-primary">
                  {initialsFor(profile.displayName, profile.email)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{profile.displayName || 'Account'}</p>
              <p className="text-xs text-muted-foreground truncate">{profile.email || '—'}</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              className="pl-9"
            />
          </div>

          {/* Items — horizontal scroll on mobile, vertical list on desktop */}
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 -mx-1 px-1">
            {filtered.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => select(s.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 lg:w-full',
                    isActive
                      ? 'bg-gradient-brand-soft text-primary ring-1 ring-primary/15'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {s.label}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground px-3 py-2">No matching settings.</p>
            )}
          </div>
        </nav>

        {/* Active section */}
        <div className="flex-1 min-w-0">
          <FadeIn key={activeId}>
            <ActiveComponent />
          </FadeIn>
        </div>
      </div>
    </PageShell>
  );
};

export default Settings;
