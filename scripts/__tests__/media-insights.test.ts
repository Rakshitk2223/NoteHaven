import {
  timeToFinish, formatDuration, buildContinueQueue, nextAiringEpisode,
  buildAiringSoon, buildGenreCounts, buildLibraryStats, findDuplicates,
  normaliseTitle, airingDayLabel,
  type InsightItem, type MetaMap,
} from '@/lib/media-insights';
import type { MediaMeta } from '@/lib/media-progress';

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`); }
};
const ok = (name: string, cond: boolean) => eq(name, !!cond, true);

const ymd = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const meta = (m: Partial<MediaMeta>): MediaMeta => ({
  description: null, episodes: null, chapters: null, total_seasons: null,
  seasons: null, banner_image: null, rating: null, status: null, genres: null,
  episodes_detail: null, cast_members: null, runtime: null, ...m,
});

const item = (p: Partial<InsightItem>): InsightItem => ({
  id: 1, user_id: 'u1', title: 'X', type: 'Series', status: 'Watching', ...p,
});

console.log('\nformatDuration');
eq('minutes', formatDuration(45), '45m');
eq('exact hour', formatDuration(120), '2h');
eq('hours+mins', formatDuration(260), '4h 20m');
eq('days', formatDuration(60 * 24 * 3), '3.0 days');
eq('many days', formatDuration(60 * 24 * 40), '40 days');

console.log('\ntimeToFinish');
eq('no meta -> null', timeToFinish(item({}), null), null);
eq('episodes with runtime',
  timeToFinish(item({ current_episode: 4 }), meta({ episodes: 10, runtime: 25 }))?.label,
  '2h 30m left');
eq('episodes without runtime',
  timeToFinish(item({ current_episode: 4 }), meta({ episodes: 10 }))?.label,
  '6 ep left');
eq('chapters never fake a duration',
  timeToFinish(item({ type: 'Manga', current_chapter: 88 }), meta({ chapters: 500 }))?.label,
  '412 ch left');
eq('caught up -> no label',
  timeToFinish(item({ current_episode: 10 }), meta({ episodes: 10 }))?.label, null);
eq('per-episode runtime beats title runtime',
  timeToFinish(item({ current_episode: 0 }), meta({
    episodes: 2, runtime: 60,
    episodes_detail: [
      { season:1, number:1, name:'a', air_date:null, runtime:20, overview:null },
      { season:1, number:2, name:'b', air_date:null, runtime:20, overview:null },
    ],
  }))?.minutes, 40);

console.log('\nbuildContinueQueue');
{
  const items = [
    item({ id: 1, title: 'Behind',   current_episode: 3, last_activity_at: '2026-08-01T00:00:00Z' }),
    item({ id: 2, title: 'CaughtUp', current_episode: 10, last_activity_at: '2026-08-10T00:00:00Z' }),
    item({ id: 3, title: 'Planned',  status: 'Plan to Watch' }),
    item({ id: 4, title: 'New',      current_episode: 1, has_new_content: true, last_activity_at: '2026-07-01T00:00:00Z' }),
  ];
  const m: MetaMap = new Map([
    [1, meta({ episodes: 10 })], [2, meta({ episodes: 10 })], [4, meta({ episodes: 10 })],
  ]);
  const q = buildContinueQueue(items, m);
  eq('excludes caught-up and planned', q.map(e => e.item.title), ['New', 'Behind']);
  eq('new content sorts first', q[0].item.title, 'New');
  eq('next label is the following episode', q[1].nextLabel, 'S1 · E4');
  eq('remaining counts correctly', q[1].remaining, 7);
}
{
  // A title with no cached metadata must still appear — otherwise a fresh
  // library shows an empty Continue rail.
  const q = buildContinueQueue([item({ id: 9, current_episode: 2 })], new Map());
  eq('unknown total still queues', q.length, 1);
  eq('unknown total remaining is 0', q[0].remaining, 0);
}
{
  const q = buildContinueQueue([item({ id: 5, type: 'Manga', status: 'Reading', current_chapter: 7 })],
    new Map([[5, meta({ chapters: 100 })]]));
  eq('manga next label', q[0].nextLabel, 'Ch. 8');
}

console.log('\nnextAiringEpisode / buildAiringSoon');
{
  const m = meta({ episodes_detail: [
    { season:1, number:1, name:'past',   air_date: ymd(-30), runtime:24, overview:null },
    { season:1, number:2, name:'soon',   air_date: ymd(3),   runtime:24, overview:null },
    { season:1, number:3, name:'later',  air_date: ymd(10),  runtime:24, overview:null },
  ]});
  eq('picks soonest unaired', nextAiringEpisode(m)?.episode.name, 'soon');
  eq('ignores aired', nextAiringEpisode(meta({ episodes_detail: [
    { season:1, number:1, name:'past', air_date: ymd(-1), runtime:null, overview:null },
  ]})), null);
  eq('no detail -> null', nextAiringEpisode(meta({})), null);

  const soon = buildAiringSoon([item({ id: 1 })], new Map([[1, m]]), 14);
  eq('within window', soon.length, 1);
  eq('label', soon[0].label, 'S1 · E2');
  eq('daysAway', soon[0].daysAway, 3);
  eq('narrow window excludes', buildAiringSoon([item({ id: 1 })], new Map([[1, m]]), 2).length, 0);
  eq('completed titles excluded',
    buildAiringSoon([item({ id: 1, status: 'Completed' })], new Map([[1, m]]), 14).length, 0);
}
eq('day label today', airingDayLabel(0, ymd(0)), 'Today');
eq('day label tomorrow', airingDayLabel(1, ymd(1)), 'Tomorrow');

console.log('\nbuildGenreCounts');
{
  const m: MetaMap = new Map([
    [1, meta({ genres: ['Action', 'Drama'] })],
    [2, meta({ genres: ['Action'] })],
    [3, meta({ genres: null })],
  ]);
  const g = buildGenreCounts([item({id:1}), item({id:2}), item({id:3})], m);
  eq('counts and orders', g, [{ genre: 'Action', count: 2 }, { genre: 'Drama', count: 1 }]);
}

console.log('\nbuildLibraryStats');
{
  const items = [
    item({ id: 1, type: 'Anime',  status: 'Completed',  rating: 10, current_episode: 12 }),
    item({ id: 2, type: 'Anime',  status: 'Watching',   rating: 7,  current_episode: 3 }),
    item({ id: 3, type: 'Manga',  status: 'Reading',    current_chapter: 50 }),
    item({ id: 4, type: 'Movie',  status: 'Plan to Watch' }),
  ];
  const m: MetaMap = new Map([
    [1, meta({ episodes: 12, runtime: 24, genres: ['Action'] })],
    [2, meta({ episodes: 24, runtime: 24, genres: ['Action','Comedy'] })],
    [3, meta({ chapters: 200 })],
  ]);
  const s = buildLibraryStats(items, m);
  eq('total', s.total, 4);
  eq('status split', s.byStatus, { inProgress: 2, planned: 1, completed: 1 });
  eq('episodes watched', s.episodesWatched, 15);
  eq('chapters read', s.chaptersRead, 50);
  eq('minutes watched', s.minutesWatched, 15 * 24);
  eq('rated count', s.ratedCount, 2);
  eq('average rating', s.averageRating, 8.5);
  eq('favourites are 9+', s.favourites.map(f => f.id), [1]);
  eq('behind count', s.behindCount, 2);
  eq('metadata coverage', s.withMetadata, 3);
  eq('top type', s.byType[0], { type: 'Anime', count: 2 });
  ok('histogram bucket 10', s.ratingHistogram[9] === 1);
}

console.log('\nfindDuplicates / normaliseTitle');
eq('strips articles + punctuation', normaliseTitle('The Boys!'), 'boys');
eq('strips season suffix', normaliseTitle('Attack on Titan Season 2'), 'attack on titan');
{
  const dups = findDuplicates([
    item({ id: 1, title: 'The Boys' }),
    item({ id: 2, title: 'the boys' }),
    item({ id: 3, title: 'Boys, The' }),
    item({ id: 4, title: 'Severance' }),
    item({ id: 5, title: 'Severance', type: 'Movie' }),
  ]);
  eq('groups near-identical titles', dups[0].map(d => d.id), [1, 2, 3]);
  eq('different types are not duplicates', dups.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
