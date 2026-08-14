import {
  nextUpLabel, timeToFinish, formatDuration, buildContinueQueue, nextAiringEpisode,
  buildAiringSoon, buildGenreCounts, buildLibraryStats, findDuplicates,
  normaliseTitle, airingDayLabel,
  type InsightItem, type MetaMap,
} from '@/lib/media-insights';
import { computeProgress, type MediaMeta } from '@/lib/media-progress';

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

console.log('\nseason-only convention (S3 with no episode = 3 seasons done)');
{
  const threeSeasons = meta({ seasons: [
    { season_number: 1, episode_count: 10, air_date: null, name: 'S1' },
    { season_number: 2, episode_count: 10, air_date: null, name: 'S2' },
    { season_number: 3, episode_count: 10, air_date: null, name: 'S3' },
    { season_number: 4, episode_count: 10, air_date: null, name: 'S4' },
  ]});
  const legacy = item({ current_season: 3, current_episode: 0 });
  eq('counts all completed seasons', computeProgress(legacy, threeSeasons).watched, 30);
  eq('percentage reflects them', computeProgress(legacy, threeSeasons).pct, 75);
  eq('marked as started', computeProgress(legacy, threeSeasons).started, true);
  eq('next up is the following season', nextUpLabel(legacy, threeSeasons), 'S4 · E1');

  const midSeason = item({ current_season: 3, current_episode: 4 });
  eq('mid-season still counts priors + current', computeProgress(midSeason, threeSeasons).watched, 24);
  eq('mid-season next episode', nextUpLabel(midSeason, threeSeasons), 'S3 · E5');

  const lastSeasonDone = item({ current_season: 4, current_episode: 0 });
  eq('finishing the last season is caught up', computeProgress(lastSeasonDone, threeSeasons).caughtUp, true);
  eq('no further season to offer', nextUpLabel(lastSeasonDone, threeSeasons), 'Caught up');

  // No cached season list: still started, still guesses the next season.
  const noMeta = item({ current_season: 2, current_episode: 0 });
  eq('season-only without metadata is started', computeProgress(noMeta, null).started, true);
  eq('next season guessed without metadata', nextUpLabel(noMeta, null), 'S3 · E1');

  eq('never started stays unstarted', computeProgress(item({}), threeSeasons).started, false);
}

console.log('\nbuildContinueQueue — bulk-backfill handling');
{
  // Mirrors the real library: one timestamp shared by most rows (migration 11a
  // backfill) plus a handful of genuinely-touched items.
  const BULK = '2026-06-22T13:08:52.843036+00:00';
  const many = Array.from({ length: 20 }, (_, i) =>
    item({ id: 100 + i, title: `Bulk ${String(i).padStart(2, '0')}`, current_episode: i + 1, last_activity_at: BULK }));
  const real = item({ id: 1, title: 'Actually watched', current_episode: 2, last_activity_at: '2026-08-09T12:00:00Z' });
  const m: MetaMap = new Map([[1, meta({ episodes: 50 })]]);
  many.forEach((x) => m.set(x.id, meta({ episodes: 50 })));

  const q = buildContinueQueue([...many, real], m, 5);
  eq('genuinely touched item leads', q[0].item.title, 'Actually watched');
  eq('touched flag set', q[0].touched, true);
  eq('bulk items are not treated as touched', q[1].touched, false);
  // Within the bulk tie, higher progress wins over arbitrary order.
  ok('bulk tail ordered by progress', q[1].pct >= q[2].pct);
}
{
  // Never-started items marked Watching should not appear.
  const BULK = '2026-06-22T13:08:52.843036+00:00';
  const items = [
    item({ id: 1, title: 'Never started', current_episode: 0, last_activity_at: BULK }),
    item({ id: 2, title: 'Never started 2', current_episode: 0, last_activity_at: BULK }),
    item({ id: 3, title: 'Never started 3', current_episode: 0, last_activity_at: BULK }),
    item({ id: 4, title: 'Never started 4', current_episode: 0, last_activity_at: BULK }),
    item({ id: 5, title: 'Never started 5', current_episode: 0, last_activity_at: BULK }),
    item({ id: 6, title: 'Never started 6', current_episode: 0, last_activity_at: BULK }),
    item({ id: 7, title: 'Never started 7', current_episode: 0, last_activity_at: BULK }),
    item({ id: 8, title: 'In progress', current_episode: 4, last_activity_at: BULK }),
  ];
  const m: MetaMap = new Map(items.map((i) => [i.id, meta({ episodes: 20 })]));
  const q = buildContinueQueue(items, m);
  eq('zero-progress bulk items excluded', q.map((e) => e.item.title), ['In progress']);
}
{
  // A never-started item still shows if it has new content or a real timestamp.
  const BULK = '2026-06-22T13:08:52.843036+00:00';
  const items = [
    ...Array.from({ length: 10 }, (_, i) => item({ id: 200 + i, title: `Pad ${i}`, current_episode: 0, last_activity_at: BULK })),
    item({ id: 9, title: 'New season', current_episode: 0, has_new_content: true, last_activity_at: BULK }),
    // ...but one you HAVE started, with new episodes, leads the rail.
    item({ id: 10, title: 'Started + new', current_episode: 5, has_new_content: true, last_activity_at: BULK }),
  ];
  const m: MetaMap = new Map(items.map((i) => [i.id, meta({ episodes: 20 })]));
  const q = buildContinueQueue(items, m);
  eq('never-started + new content is excluded; started + new leads',
    q.map((e) => e.item.title), ['Started + new']);
}
{
  // With no bulk timestamp present, ordering stays plain recency.
  const items = [
    item({ id: 1, title: 'Older', current_episode: 1, last_activity_at: '2026-08-01T00:00:00Z' }),
    item({ id: 2, title: 'Newer', current_episode: 1, last_activity_at: '2026-08-10T00:00:00Z' }),
  ];
  const m: MetaMap = new Map(items.map((i) => [i.id, meta({ episodes: 20 })]));
  eq('no bulk -> pure recency', buildContinueQueue(items, m).map((e) => e.item.title), ['Newer', 'Older']);
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
