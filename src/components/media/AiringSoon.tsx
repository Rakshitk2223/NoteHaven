import { CalendarClock, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { airingDayLabel, type UpcomingEpisode } from '@/lib/media-insights';
import { CoverArt } from './CoverArt';

interface AiringSoonProps {
  episodes: UpcomingEpisode[];
  covers: Map<number, string | null>;
  onOpen: (id: number) => void;
}

/**
 * Upcoming episodes for titles you track, read straight out of the cached
 * `episodes_detail` air dates.
 *
 * TMDB and TVmaze return full episode lists with air dates (cached metadata, or a
 * linked title's source); this rail is where they show up.
 */
export function AiringSoon({ episodes, covers, onOpen }: AiringSoonProps) {
  // Nothing upcoming: stay quiet (the library-update pass keeps linked titles current).
  if (episodes.length === 0) return null;

  // Group by day so the rail reads as a schedule rather than a flat list.
  const byDay = new Map<string, UpcomingEpisode[]>();
  for (const ep of episodes) {
    const bucket = byDay.get(ep.date);
    if (bucket) bucket.push(ep);
    else byDay.set(ep.date, [ep]);
  }

  return (
    <section className="mb-6" aria-labelledby="airing-heading">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-accent-2" />
        <h2 id="airing-heading" className="text-base font-bold text-foreground sm:text-lg">
          Airing soon
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {episodes.length}
        </span>
      </div>

      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[...byDay.entries()].map(([date, eps]) => {
          const today = eps[0].daysAway === 0;
          return (
            <div key={date} className="flex-shrink-0">
              <p
                className={cn(
                  'mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide',
                  today ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {today && <Radio className="h-3 w-3 animate-pulse" />}
                {airingDayLabel(eps[0].daysAway, date)}
              </p>

              <div className="flex gap-2">
                {eps.map((ep) => {
                  const cover = ep.item.cover_image ?? covers.get(ep.item.id) ?? null;
                  return (
                    <button
                      key={`${ep.item.id}-${ep.episode.season}-${ep.episode.number}`}
                      type="button"
                      onClick={() => onOpen(ep.item.id)}
                      title={ep.episode.name ? `${ep.item.title} — ${ep.episode.name}` : ep.item.title}
                      className={cn(
                        'group flex w-[132px] flex-col overflow-hidden rounded-lg border bg-card/60 text-left transition-all hover:border-border-strong',
                        today ? 'border-primary/40' : 'border-border/60',
                      )}
                    >
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                        <CoverArt src={cover} title={ep.item.title} initials={1} lazy
                          letterClassName="text-2xl font-black text-primary/70"
                          imgClassName="transition-transform duration-500 group-hover:scale-105" />
                        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {ep.label}
                        </span>
                      </div>
                      <div className="p-2">
                        <p className="truncate text-[11px] font-semibold leading-tight text-foreground">
                          {ep.item.title}
                        </p>
                        {ep.episode.name && (
                          <p className="truncate text-[10px] text-muted-foreground">{ep.episode.name}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
