import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/work/ProjectCard';
import { formatMonth, formatDuration, type WorkProject, type WorkStatus } from '@/lib/work';

const HEADINGS = ['Project', 'Helped', 'Team', 'Month', 'Duration', 'Status', ''] as const;

/**
 * Dense alternative to the card grid — for scanning a year of work rather than
 * browsing it. Scrolls inside its own container so the page never scrolls
 * sideways on mobile.
 */
export function ProjectTable({ projects, onEdit, onDelete }: {
  projects: WorkProject[];
  onEdit: (p: WorkProject) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="zen-shadow overflow-x-auto rounded-[var(--radius-md)] border border-border bg-card">
      <table className="w-full min-w-[52rem] border-collapse">
        <thead>
          <tr className="bg-secondary/50">
            {HEADINGS.map((h, i) => (
              <th
                key={h || `actions-${i}`}
                className={cn(
                  'whitespace-nowrap border-b border-border px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                  h === '' && 'w-12',
                )}
              >
                {h === '' ? <span className="sr-only">Actions</span> : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              onClick={() => onEdit(p)}
              className="group cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-secondary/40"
            >
              <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
              <td className="max-w-[22rem] px-4 py-3 text-sm text-muted-foreground">
                <span className="line-clamp-2">{p.helped.join(', ') || '—'}</span>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">{p.team || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-muted-foreground">
                {formatMonth(p.month)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-muted-foreground">
                {formatDuration(p)}
              </td>
              <td className="px-4 py-3"><StatusPill status={p.status as WorkStatus} /></td>
              <td className="px-4 py-3">
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  title="Delete"
                  aria-label={`Delete ${p.name}`}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
