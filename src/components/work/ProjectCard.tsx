import { Pencil, Trash2, Clock, Calendar as CalendarIcon, ExternalLink } from 'lucide-react';
import { TagBadge } from '@/components/TagBadge';
import { cn } from '@/lib/utils';
import {
  formatMonth, formatDuration, initials, avatarIndex, AVATAR_TINTS, STATUS_META,
  type WorkProject, type WorkStatus,
} from '@/lib/work';
import type { Tag } from '@/lib/tags';

/** Status as colour AND shape, so state reads at a glance without relying on hue. */
export function StatusPill({ status }: { status: WorkStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn(
      'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
      meta.cls,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Overlapping initial-avatars, capped with a "+n" chip. */
export function Avatars({ people, max = 3 }: { people: string[]; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex flex-shrink-0">
      {shown.map((person, i) => (
        <span
          key={`${person}-${i}`}
          title={person}
          className={cn(
            'grid h-6 w-6 place-items-center rounded-full border-[1.5px] border-card text-[10px] font-semibold',
            AVATAR_TINTS[avatarIndex(person)],
            i > 0 && '-ml-1.5',
          )}
        >
          {initials(person)}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 grid h-6 w-6 place-items-center rounded-full border-[1.5px] border-card bg-muted text-[10px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** "for Priya Menon, Arjun Rao · Field Ops" — the line that makes this a help log. */
function HelpedLine({ project }: { project: WorkProject }) {
  const names = project.helped;
  const lead = names.slice(0, 2).join(', ');
  const extra = names.length - Math.min(names.length, 2);
  return (
    <div className="flex items-center gap-2">
      <Avatars people={names} />
      <p className="min-w-0 truncate text-xs text-muted-foreground">
        for <span className="font-medium text-foreground">{lead}</span>
        {extra > 0 && ` +${extra}`}
        {project.team && ` · ${project.team}`}
      </p>
    </div>
  );
}

export function ProjectCard({ project, tags, onEdit, onDelete }: {
  project: WorkProject;
  tags: Tag[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div onClick={onEdit} className="zen-card group flex h-full cursor-pointer flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-[15px] font-semibold leading-snug">{project.name}</h3>
        <StatusPill status={project.status as WorkStatus} />
      </div>

      {project.description && (
        <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{project.description}</p>
      )}

      <HelpedLine project={project} />

      {/* Tags sit in the body, not the footer. Keeping them out of the footer row
          is what makes every card's footer exactly one line high — otherwise a
          card with a tag + link wrapped to two lines while its neighbours
          stayed at one, and the row looked ragged. */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.slice(0, 3).map((tag) => <TagBadge key={tag.id} tag={tag} size="sm" />)}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-border pt-3">
        <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          {formatMonth(project.month)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate">{formatDuration(project)}</span>
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {project.link && (
            <a
              href={project.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open link"
              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-accent-2"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          {/* Actions — hover-revealed on desktop, always visible on touch */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title="Edit"
              className="grid h-7 w-7 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete"
              className="grid h-7 w-7 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
