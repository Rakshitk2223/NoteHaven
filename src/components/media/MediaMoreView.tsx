import type { ReactNode } from 'react';
import {
  BarChart3, CheckSquare, Download, Eye, FileSpreadsheet, FileText, LayoutGrid, RefreshCw, SlidersHorizontal, Upload,
  type LucideIcon,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { GridSize } from './grid-size';

interface MediaMoreViewProps {
  totalTitles: number;
  gridSize: GridSize;
  onGridSize: (size: GridSize) => void;
  showRails: boolean;
  onToggleRails: () => void;
  onStats: () => void;
  onSelect: () => void;
  onManageTabs: () => void;
  onRefreshLibrary: () => void;
  onImport: () => void;
  importing: boolean;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportTxt: () => void;
}

function Row({ icon: Icon, label, hint, onClick, disabled, trailing }: {
  icon: LucideIcon; label: string; hint?: string; onClick?: () => void; disabled?: boolean; trailing?: ReactNode;
}) {
  const body = (
    <>
      <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {trailing}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2';
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(cls, 'transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50')}
    >
      {body}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="px-4 pb-1 pt-5 text-sm font-semibold text-foreground">{title}</h2>
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">{children}</div>
    </section>
  );
}

/**
 * Media → More: every library-wide action in one place (it replaces the two
 * copy-pasted header menus). Lists only things that work today.
 */
export function MediaMoreView(p: MediaMoreViewProps) {
  return (
    <div className="mx-auto max-w-xl pb-6">
      <Group title="Library">
        <Row icon={BarChart3} label="Library stats" hint={`${p.totalTitles.toLocaleString()} titles`} onClick={p.onStats} />
        <Row icon={CheckSquare} label="Select titles" hint="Change status, refresh covers or delete several at once" onClick={p.onSelect} />
        <Row
          icon={Eye}
          label="Continue & Airing soon"
          hint="The rails above your library"
          trailing={<Switch checked={p.showRails} onCheckedChange={p.onToggleRails} aria-label="Show Continue and Airing soon" />}
        />
      </Group>

      <Group title="Display">
        <Row
          icon={LayoutGrid}
          label="Cover size"
          trailing={(
            <div role="radiogroup" aria-label="Cover size" className="flex rounded-lg border border-border p-0.5">
              {(['S', 'M', 'L'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={p.gridSize === s}
                  aria-label={{ S: 'Small', M: 'Medium', L: 'Large' }[s]}
                  onClick={() => p.onGridSize(s)}
                  className={cn(
                    'h-9 w-10 rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    p.gridSize === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        />
        <Row icon={SlidersHorizontal} label="Type tabs" hint="Choose which types get a tab" onClick={p.onManageTabs} />
      </Group>

      <Group title="Details & covers">
        <Row icon={RefreshCw} label="Refresh library…" hint="Fetch missing covers, synopses and totals" onClick={p.onRefreshLibrary} />
      </Group>

      <Group title="Import & export">
        <Row icon={Upload} label={p.importing ? 'Importing…' : 'Import JSON…'} onClick={p.onImport} disabled={p.importing} />
        <Row icon={Download} label="Export JSON" hint="Full backup, with tags" onClick={p.onExportJson} />
        <Row icon={FileSpreadsheet} label="Export CSV" onClick={p.onExportCsv} />
        <Row icon={FileText} label="Export TXT…" hint="A plain list, by type" onClick={p.onExportTxt} />
      </Group>
    </div>
  );
}
