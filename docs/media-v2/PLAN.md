# Media v2: the Mihon-style source-linked library

## Context
Media is Rakshit's most-used tab by far. He logs manhua, manhwa, manga, anime, series and movies that he
reads or watches on other platforms, and he wants it to feel like Tachiyomi/Mihon: "mind-blowing".
Today every entry is **a typed title and nothing else**, and every refresh **re-guesses** which real work
that title means. The audit measured what that costs:
- **193 of 612** reading entries have non-comic covers. Only `type === 'manga'` was treated as a comic,
  so manhwa and manhua were searched as anime, and the fallback chain ended in TV sources.
- One typo ("Book eating magician**s**") made the only matching source return the light *novel*.
- Refresh was a slot machine: it rotated to the next source every time. His "cover exists → keep"
  guard is the lock he added after each win.
- The data exists but is **hidden**: 98% of titles have a synopsis and 99% a cover, but the synopsis isn't
  on the grid and is two screens down on phone. The real gap is chapter totals: manhua 38%, manhwa 59%,
  manga 53%.
- 50 chapters = 50 taps on a 24px button. Duplicated controls: status ×3, rating ×2, Edit ×3.
- **Nothing can fetch by id today.** The edge function takes `q` only (no `id` param). `media_tracker`
  has no source columns. `media_metadata` is keyed by `UNIQUE(title,type)`, and only 3 id slots
  (anilist/tmdb/mal) exist, on shared rows.

**Outcome:** each entry is bound once, by search-and-pick, to a source id. Refresh fetches by id, so it
returns the same answer every time. The user's fields are structurally out of refresh's reach. The detail
view shows everything the source knows, including **latest chapter / "N behind"**. Logging takes one
gesture.

## Already decided (don't re-ask)
- Keep AniList (personal use; stay ≤30 req/min). In-app "N behind" is in scope; push notifications stay
  declined.
- Data safety: schema changes are **additive only**, written as a migration file he pastes; nothing may
  delete or bulk-overwrite user rows; take a fresh backup before any bulk linking write.
- Keep his existing-cover guard until linking ships; after that, "pinned" replaces it.
- Extend the existing Aurora tokens and components; no second design system.
- The iOS reader app stays out of scope. **Importing Tachimanga backups is in scope** (unit U2b, below).

## Decided 2026-09-29 (Rakshit, after the coherence review; don't re-ask)
1. **Import before linking.** The Tachimanga import (U2b) ships before "Link your library" (U3).
2. **N behind = the higher of the two latests,** and both are shown: the source's
   (`last_known_latest_chapter`) and the reader's (`reader_latest_chapter`, from the import). For
   example, "120 out · 118 on <source>".
3. **Source art is the default cover for linked reading titles.** The Tachimanga thumbnail is the
   fallback (see the cover priority below).
4. **Covers are copied into Storage only if thumbnails fail to load** directly. The U2b preview
   measures this first, so E2 / migration 30 may never happen.
5. **Refresh Library and Sync activity are removed in U4.** First, `release_date` (their only writer)
   moves into the library-update pass.
6. **"Set back" is a per-row tick in the import preview, off by default.** Without it the import only
   moves progress forward.
7. **The import sets `platform` only when it's empty**, and never writes `resume_url`.

Butler overrides recorded with the review: keep the edge function's merge-upsert into `media_metadata`
(`e6916aa`) until U4 retires the legacy path, because deleting it now would re-search every unlinked
title on every visit.

## Prerequisite: land fix batch 1 + 1c (his hands, then /ship). Media v2 edits start after the ship, so commits stay separable.
1. Paste SQL 24 → 25 → 26 → 27 in the Supabase SQL editor.
2. Mac terminal: `npm run backup:vault`, `./deploy-edge-function.sh`, `supabase secrets list` (to confirm TMDB).
3. UX runs the approved forced refresh on "Book eating magicians"; the browser verification table closes.
4. `/ship`: one commit for docs, one for fix batch 1, pushed to GitHub.

## Architecture: two halves per entry
| User-owned (`media_tracker`, never touched by refresh) | Source-owned (new `media_source_meta`, refreshed by id) |
|---|---|
| title (display), type, status, rating, current_season/episode/chapter, tags, **platform**, **resume_url**, **cover_pinned** | titles + alt titles, synopsis, authors/artists/studios, genres, status, score, cover, banner, totals, **latest_chapter**, seasons/episodes, cast, source_url, year, country, format |

### Migration `28_media_source_links.sql` (27 is the notes realtime fix): additive, idempotent, tested in PGlite, with a fresh build + re-run
- Also in 28: `media_progress_log` (History) and `media_tracker.latest_changed_at` (Updates).
- `media_tracker` ADD: `source` TEXT (anilist|mangaupdates|mangadex|jikan|tmdb|tvmaze), `source_id` TEXT,
  `alt_ids` JSONB (e.g. `{"anilist":…,"mal":…,"mu":…,"tmdb":…}`), `link_status` TEXT CHECK
  (unlinked|linked|review) DEFAULT 'unlinked', `linked_at`, `cover_pinned` BOOL DEFAULT false, `platform`
  TEXT, `resume_url` TEXT, `last_known_latest_chapter` NUMERIC, `latest_checked_at`. Add an index on
  (user_id, link_status).
- NEW `media_source_meta` with PK (source, source_id): the normalized fields from the right-hand column
  above, plus `fetched_at`. RLS: public SELECT, **no client writes** (written only by the edge function
  with the service role). That closes the cross-tenant cache-poisoning risk for v2 data.
  `media_metadata` stays as the legacy cache for unlinked entries.
- `types.ts` regenerated by hand to match.

### Edge function `media-search` (new actions; each phase needs his redeploy)
Reuse the existing per-source fetchers, the `SOURCE_SPACING_MS` pacing, `corsFor`, and
`isAuthenticatedUser` (`supabase/functions/media-search/index.ts`). Add:
- `action=search&q&type&limit`: fan out to **type-correct** sources only (manhwa: AniList KR +
  MangaUpdates + MangaDex; manhua: MangaUpdates + AniList CN; manga: AniList JP + Jikan + MU; anime:
  AniList + Jikan; series/dramas: TMDB + TVmaze; movie: TMDB). Return **candidates with their own ids**:
  `{source, source_id, title, alt_titles, cover, year, authors, format, country, status, chapters|episodes,
  latest_chapter?, score}`. Fix the mappers: keep `series_id`, the MangaDex uuid, the TVmaze id and
  `idMal`; emit `null`, never `0`/`'upcoming'`; normalize every status vocabulary. Nothing is persisted
  from a search.
- `action=detail&source&id`: by-id fetch (AniList `Media(id)`, MU `GET /v1/series/{id}`, MangaDex
  `/manga/{uuid}`, Jikan `/{anime|manga}/{id}`, TMDB `/3/{tv|movie}/{id}`, TVmaze `/shows/{id}`). Upsert
  `media_source_meta` and return the normalized detail. For reading types, also fetch
  **latest_chapter** from MU (preferred for manhwa/manhua) or MangaDex `/manga/{id}/aggregate` when it's
  hosted there. For anime, AniList `nextAiringEpisode`.
- ~~`action=resolve` (POST, ≤10 items): for "Link your library", return the top 3 candidates per item
  with a confidence score (below). Pace AniList at ≥2100 ms.~~ Built, never called, **removed
  2026-09-29 (BE2)**. Phase 2 calls `action=search` in a client-paced loop instead.
- Don't hotlink MangaDex covers (they're blocked); prefer AniList/MU covers.

### Client lib (reuse `mediaSearchGet` in `src/lib/edge-function.ts`; extend `media-progress.ts`)
- `src/lib/media-sources.ts`: typed wrappers `searchSources`, `fetchSourceDetail` (`resolveBatch` was
  built, then removed 2026-09-29 with the edge `resolve` action).
- `src/lib/media-match.ts` (**pure**): normalized-title similarity against the title plus all alt titles
  (case, punctuation, leading "the", a trailing plural `s`, season suffixes), plus a type/country gate,
  year proximity, and plausibility (candidate `latest`/`chapters` ≥ his progress). Score ≥0.9 → auto-link;
  0.6–0.9 → review; <0.6 → unlinked. Reuses `normaliseTitle` (`media-insights.ts:512`) and the
  `cover-medium.ts` guards.
- `src/lib/media-link.ts`: `linkEntry(trackerId, candidate)` writes only the link fields. It fetches
  detail, and sets the cover **only if `!cover_pinned`** and (for existing entries) only if the current
  cover fails `isUsableCover`, or he accepts "use new cover".
- `nextProgress(item, meta, {delta}|{set})` in `media-progress.ts` (season rollover, clamp at 0..latest),
  used by one `useProgressMutation` built on the compare-and-swap `applyProgressDelta`
  (`MediaTracker.tsx:1331`).
- **Vitest** set up for `src/lib` (the one backlog item he kept), with tests for `media-match`,
  `nextProgress` and the mappers' normalization. Hook it into `.github/workflows/ci.yml` (`test:insights`
  already runs there).

## Phases as first planned (2026-09-28; each: build → tsc/lint/build/Vitest → UX browser check at 390 + 1440 with `[audit]` rows → his redeploy/SQL → ship)
> **History.** Phase 1 below is what was built on `media-v2`. Phases 2 and 3 are **superseded** by the
> U0 → U6 roadmap in "Re-cut 2026-09-29" further down. They're kept here as the record of the original
> intent.

**Phase 1: link, fetch by id, and log fast** (nav: Library · History · Browse · More)
- **Add = search-and-pick sheet** (one flow; replaces Quick Add and the empty-state form). Type the title,
  get live candidates grouped by source (cover, title, alt title, author, year, "Ch 140 · ongoing" / "12
  eps"), tap one, see a preview, choose status + progress (typed number) → **Add**. "Add without
  linking" is always there. Built on `src/components/ui/command.tsx` (cmdk `Command` with
  `shouldFilter={false}`) inside the existing mobile-safe Sheet/Dialog.
- **Log sheet + ProgressControl** (moved up from phase 3, since it's the #1 daily pain): tap the number to get a big numeric input, +1/+5/+10/+50 chips, one write, and Undo. 44px targets everywhere. Built on the compare-and-swap writer.
- **History tab:** new `media_progress_log` table (additive, in migration 28, RLS `user_id = auth.uid()`), written by the one progress writer (from→to, at) as a **separate insert AFTER the compare-and-swap UPDATE confirms**. A failed log insert never blocks or rolls back progress. **Append-only:** Undo writes its own reverse row and never deletes one. History reads it; nothing else writes it.
- **Mihon Library grid**, responsive as in the table above, with the behind badge shown only when a latest is known.
- **Detail sheet, reordered:** hero (cover, title, alt title, author/studio, status, "via AniList" chip)
  → action row (Log, Open where I read ↗, Fix match, Pin cover) → 3-line synopsis with "More" → progress
  → genres → seasons/episodes → cast.
- **Fix match** (card menu + sheet): the same picker, prefilled. Relinking replaces the cover unless it's
  pinned. Remove cover sets `cover_pinned` with a null cover ("no cover wanted").
- Refresh on linked entries fetches by id. Unlinked entries keep today's path (with the batch-1 fixes).
- Existing-UI quick wins in the same pass: drop the duplicate status badge/row, the passive rating box,
  the footer Close and the kebab cover actions (keep them in the sheet only); move Delete into a kebab;
  focus the progress field when editing from progress (UX-18); fix the sheet ✕ overlapping Edit (UX-23);
  "Read next" for reading types (UX-16); solid badge backgrounds (UX-17); one `MediaActionsMenu`;
  iPad 1180 chip-row clipping.

**Phase 2: link your library** (1,259 titles)
- **Dry run first:** a background resolver (≤1 item per 2.5 s, resumable, a "Linking · 812/1,259" pill)
  computes proposals **without writing** and shows counts: auto / review / unlinked. He approves, then it
  writes. **Take a backup first** (run `backup-media.ts`, plus a fresh export).
- Review queue ("Needs a match · N"): top 3 candidates side by side, one tap each, or skip, or "not
  listed". It keeps his existing covers unless they fail the medium check (the 193 from `audit:covers`)
  or he taps "use new cover".

**Phase 3: Updates and the rest of the daily loop** (the Updates tab appears here, once its data exists)
- **Updates tab:** `latest_changed_at` on the tracker (migration 28) is stamped whenever a refresh sees the latest grow. Updates lists titles whose latest grew, grouped by day. "Caught up (N)" appears in the Log sheet once a latest is known. Hold + to repeat (coalesced write). Season picker plus "Next season"; movies get "Watched ✓".
- **Latest / N-behind:** the card badge (Mihon's unread-count position) plus a "Behind" filter.
  Refreshed on open and in a paced background pass for in-progress linked titles. When nothing
  publishes a latest for a title, it shows "latest unknown" and never guesses.
- **Platform + resume link:** "Open on <platform> ↗" on the card, sheet and rail, plus a platform
  filter chip.
- The chosen **visual direction's** layout (below).
- **Extraction** as we touch code: `MediaTracker.tsx` (3,874 lines) →
  `hooks/media/{useMediaLibrary,useMediaMutations,useMediaMetadata,useMediaFilters}`,
  `components/media/{ProgressControl,MediaDetailSheet/*,SourcePicker,LogSheet,MediaActionsMenu}`,
  following the seams in the frontend report's Media deep-dive.

## Re-cut 2026-09-29: one writer per field (from the coherence review)
The five Media features do three jobs: **what you did** (progress: the manual Log plus the Tachimanga
import), **what the work is** (identity and metadata: the source link) and **what it looks like** (the
cover). Before this review each job had 2–5 writers with different rules. The fix is one writer per
field, one review component (a shared `ReviewCard` for Fix match, the Phase 2 queue and the Tachimanga
preview), one undo journal, and deleting the legacy title-guessing paths in named units.

The Tachimanga import replaces **logging**, not linking. The backup carries no source ids, so the order
is import (U2b) → link (U3) → re-upload.

### A. Who may write each field
| Field | Writers (priority) | Never | On disagreement |
|---|---|---|---|
| Progress | 1 Log / Edit (either direction); 2 Tachimanga apply (forward only, compare-and-swap against the preview snapshot, after approval); restore creates new rows only | refresh, link, Sync activity, scripts | the higher value stays (reader 40 vs NoteHaven 52 → 52); a "NoteHaven ahead" group with a per-row "Set back" tick, off by default |
| `last_activity_at` | progress writes; the import sets max(current, reader last-read) | cover writes (they bump it today; U0 stops that) | — |
| Latest / N behind | source `last_known_latest_chapter` (`linkEntry` / `refreshLinked`); reader `reader_latest_chapter` (the import only) | legacy `media_metadata.chapters` | read the max; the Log sheet shows both; stamp `latest_changed_at` when the max grows |
| Cover | see D | refresh-by-id, the display-time search, scripts | a pin always wins; automatic writes only fill a missing or suspect cover |
| Synopsis, genres, status, totals | the edge function → `media_source_meta` only | the client, the import (reader metadata is never stored) | linked: the source wins and legacy fills blanks; unlinked: legacy, frozen |
| Identity (`source`, `source_id`, `alt_ids`) | Browse add, Fix match, Phase 2 approve, unlink | refresh, import, restore | the reader's identity lives in `media_import_map`, never in `alt_ids` (`linkEntry` overwrites those) |
| `platform`, `resume_url` | the Edit form; the import fills `platform` only when empty | everything else | typed values are never overwritten |

**Restore is not an undo:** it inserts new rows, so it duplicates `media_tracker`. The backup is the
disaster floor; `media_bulk_journal` is the undo.

### D. Covers
- **One writer:** `setCover(id, url, origin)`, with the pin guard inside the UPDATE, a journal row and
  `cover_origin`. **One judge:** `coverVerdict(url, type, origin)` in `lib/cover-medium.ts` (ok /
  wrong-medium / blocked / unverified). It runs at write time, in the review counts and in `audit:covers`.
- **Priority:**
  1. His own pick or pin ("Change cover…" pins).
  2. The linked source's cover.
  3. The Tachimanga thumbnail, kept in `media_import_map`. A re-upload fixes a dead URL.
  4. The existing legacy cover, if `coverVerdict` passes it.
  5. The letter tile.
- **Web search is never automatic** (it made the wrong covers the audit counted). Its results appear only
  as options in "Change cover…".
- **Display:** `cover_image` → the linked source's cover → the letter tile. The display-time search is cut
  in U4.
- **Storage copy (E2):** measure first. The U2b preview test-loads thumbnails (no-referrer). Only if fewer
  than about 95% load: `cover_copy` with SSRF guards (https only, no IP literals, `image/*` ≤ 2 MB, at most
  2 redirects, the caller must own the `media_id`, a daily cap, content-hashed keys).

### E. One entry point per job
| Job | The one place |
|---|---|
| Log progress | the Log sheet |
| Add a title | Browse |
| Sync from Tachimanga | More → Import… (`.tmb`) → full-screen preview |
| Link the library | More → Link your library, plus a header pill while it runs |
| Pick matches | header chip "Needs a pick · N" |
| Fix identity | detail ⋮ → Fix match |
| Fix a cover | detail ⋮ → Change cover… / Pin / Remove |
| Fresh metadata / latest | automatic, plus pull-to-refresh on Updates |
| New chapters | the Updates tab (U4) |
| History | the History tab (import rows labelled) |
| Undo a bulk change | its toast, plus More → Undo last bulk change |
| Backup | Settings → Data (bulk dialogs run the export inline first) |

**Removal list** (each goes in the unit named; nothing runs in parallel with its replacement):
- **U0 / E1:** `resolveBatch` and the edge `resolve` action (unused). ✅ Done 2026-09-29 (BE2).
- **U2b:** the "Import JSON" row becomes one "Import…" row that detects `.json` vs `.tmb`.
- **U4:** Refresh Library, `RefreshActivityContext`, Settings → Sync activity, the "New seasons" filter and
  dot (`has_new_content` stops being read), the display-time cover search, `backfill-media-metadata`.
- **U5:** Refresh cover (the slot machine), bulk refresh covers, `media-refresh.ts`, the legacy
  `removeCoverImage`, `backfill-cover-images`.

### F. Migration `29` (one paste, idempotent)
> **Live on production since 2026-09-29** as `29_media_v2_import_link.sql`. As built, it also adds
> `media_bulk_journal.op` (update | insert, so Undo can remove a title the import created),
> `media_tracker.last_known_latest_season` / `last_known_latest_episode` (for U4's watch-type latest), and
> a `cover_origin` CHECK (manual, source, reader, search). It runs as one transaction behind a status
> pre-check. The list below is the scope as planned.

1. `media_link_proposals` (no `applied` or `batch_id` columns).
2. `media_import_map` (`user_id`, `origin`, `origin_key` = sha256 of `source:url`, `media_id` FK cascade,
   `reader_cover`, `last_seen_at`; PK `user_id + origin + origin_key`).
3. `media_bulk_journal` (`id`, `user_id`, `batch_id` uuid, `kind` link | import | cover, `media_id` FK
   cascade, `before` jsonb, `after` jsonb, `created_at`, `undone_at`).
4. `media_tracker` ADD `reader_latest_chapter` numeric, `reader_checked_at` timestamptz, `cover_origin` text.
5. `media_progress_log` ADD `origin` text.
6. The `status` CHECK gains `'Dropped'` and `'On Hold'`, guarded. This is the only change that isn't an ADD.
7. RLS: own rows, plus an EXISTS check that the tracker row is the caller's. The journal allows UPDATE of
   `undone_at` only.

**Not in 29:** reader titles or metadata, `media_metadata` changes, dropped columns, writes of
`link_status = 'review'`, triggers, pg_cron, or a Storage bucket (that would be 30, with E2, only if
needed).
**Same unit as 29:**
- Tables 1–3 go into `EXPORT_TABLES` and `backup-media` `TABLES`.
- Restore remaps `media_import_map` by `media_id` and drops unmapped rows. Proposals and the journal are
  never restored.
- `types.ts` is updated.

**Edge:** E1 ships with the Phase 1 deploy (the v2 actions, minus `resolve`). The import, the linking and
the library update need **no** deploy. E2 only if needed.

### G. Roadmap U0 → U6 (U6 parked; scope frozen at U0–U5, 2026-09-29)
**Status (2026-09-29, final): U0 → U5 are all done on `media-v2`. Open before shipping: E1 (the one edge
redeploy) and the phone browser pass.**
| Unit | Status |
|---|---|
| U0 | ✅ done on the branch: pin guards on every legacy cover writer, cover writes no longer bump `last_activity_at`, Edit → Update stays with "Saved · Undo", Library stats over the whole library, one `latestOf` (pulled forward from U4) for badge + Behind filter, `resolve` removed, `main` merged in (`84fadef`). **Still open: E1, the one edge redeploy, at ship** |
| U2a | ✅ done: migration 29 live, Dropped / On Hold, platform + resume link in Edit and PickPreview |
| U2b | ✅ done: the Worker + sql.js parser, the pure planner, the preview, guarded apply through the one progress writer (`lib/media-progress-write.ts`), the journal and "Undo last bulk change" (`lib/media-bulk.ts`), the backup gate (`lib/full-export.ts`), a synthetic fixture generator, and Vitest |
| U3 | ✅ done: the paced, resumable resolver (`lib/media-resolve.ts`) → `media_link_proposals`; the "Linking" pill and "Needs a pick · N" chip; Auto-matched and the `ReviewCard` queue; guarded `linkEntry(…, { expect, keepCover })`; journaled Approve behind the shared backup gate; linked titles read `media_source_meta` everywhere (`metaFor`) |
| U4 | ✅ done: the library update pass (`lib/media-update.ts`: by id, paced, 6 h per title, never lowers a latest, aired episodes from edge `detail.last_aired`, `release_date` moved here); the Updates tab; one Web Lock shared with the resolver. Removed: Refresh Library, `RefreshActivityContext`, Settings → Sync activity, `has_new_content` reads, the display-time cover search. `backfill-media-metadata.ts` also removed (`71b4600`). **Not removed as planned:** the edge `media_metadata` merge-upsert and the legacy `q=` / `source=` / batch paths, now dead code with no caller |
| U5 | ✅ done: `coverVerdict` (the one judge), `lib/media-cover.ts` `setCover(s)` (the one writer, journaled), Change cover… (web search on tap only), Wrong covers · N. A Change cover… pick pins (`6144851`); cover writes journal every 5. Removed: the slot machine, bulk refresh covers, `media-refresh.ts`, `removeCoverImage`, `backfill-cover-images`. E2 (a cover Storage copy) not needed so far |
| Deploy | **Correction to § F "Edge":** linking (`action=search`) and the update pass (`action=detail`, which gained `last_aired` in U4) *do* depend on E1, like Browse. Only the Tachimanga import works without it |
| U6 | parked (`docs/BACKLOG.md`) |

| Unit | Contents | Removes | Depends on | Size |
|---|---|---|---|---|
| **U0** ✅ Phase 1 ship | the Phase 1 fixes; the gate at 390 / 820 / 1180 / 1440; pin guards on the 3 legacy cover writers (bulk refresh, `refreshCoverImage`, Sync activity retry); Sync activity "Remove" uses `setCoverPinned`; cover writes stop bumping `last_activity_at`; the Behind filter uses `behindCount`; E1; merge | `resolveBatch`, edge `resolve` | his deploy | S–M |
| **U2a** ✅ statuses and fields | paste 29; Dropped / On Hold in filters, rails and badge suppression (**before any badge lights up**); `platform` + `resume_url` in Edit and PickPreview | — | 29 | S |
| **U2b** ✅ Tachimanga import | a Worker + sql.js; the matcher (import map → title → linked alt titles, reading rows only; a new title's type is a required pick); the preview; apply through a compare-and-swap lib extracted from `useProgressMutation`; History `origin`; the reader latest in the badge and sort; the backup gate; journal Undo; a fixture + Vitest | the "Import JSON" row | U2a, sql.js | L |
| **U3** ✅ Link your library | the resolver, proposals, one-tap auto band, the `ReviewCard` queue (watch types and unmapped reading rows first), duplicates, suspect covers → the source cover via `setCover`; grid, rails, genres and sorts read `media_source_meta` for linked rows (legacy becomes a read-only fallback) | — | U2b | L |
| **U4** ✅ library update + Updates | paced `refreshLinked` on open and on pull; `release_date` moves here; episode latest for watch types (anime from TMDB / TVmaze seasons, since AniList splits seasons); the Updates feed (it needs two observations); one `latestOf(item, meta)` for badge, filter, sort, clamp and Updates | Refresh Library, Sync activity, `has_new_content` reads, the display-time search, the `media_metadata` merge-upsert | U3 | L |
| **U5** ✅ covers | `setCover` everywhere, `coverVerdict`, the "Change cover…" picker, "Wrong covers · N"; E2 only if needed | the slot machine, bulk refresh, the legacy remove, the cover backfill | U3 (+ U2b) | M |
| ~~**U6** rest of Phase 3~~ **parked, see `docs/BACKLOG.md`** (scope frozen at U0–U5, 2026-09-29) | hold-to-repeat, season picker, "Caught up", Mac hover +1 | — | U4 | M |

## Visual direction: A · Mihon Library (Rakshit, 2026-09-28; demo https://claude.ai/artifact/CYGnLNArE56iqP2wVwRGBL)
Dense cover grid, a behind-count badge in Mihon's unread spot, Library / Updates / History / Browse /
More, a Mihon-style detail page, and Browse as search-and-pick. **Responsive, not "the phone but bigger":**
| | Phone (<768) | iPad (768–1279) | Mac (≥1280) |
|---|---|---|---|
| Section nav | bottom bar with **Media sections only** (Library · Updates · History · Browse · More); the PageShell hamburger stays, so the app sidebar is still reachable; `env(safe-area-inset-bottom)` padding for the installed PWA | bottom bar in portrait; top tabs in landscape | top tab strip in the page header (the app sidebar stays) |
| Library grid | 3 cols | 4–5 cols | 6–8 cols, with a size slider (S/M/L remembered) |
| Detail | full-screen page | right-side sheet over the grid | **two-pane**: the grid stays, and a detail panel (≈420px) opens on the right; ←/→ steps through titles |
| Browse | source rows, horizontal scroll | same | a column per source, side by side |
| Log | bottom sheet | bottom sheet | popover anchored to the number; keys `+`/`-`, `=` or Enter to type, ⌘K "eleceed +50" |
| Hover | none | none | a quick +1 and a Log button on the cover when hovered (also reachable by keyboard) |

## Definition of done: NO HOLES (Rakshit's rule; applies to every phase)
A phase ships only when all of these hold:
1. **Every surface it introduces is complete at 390 / 820 / 1180 / 1440**, including the empty, loading,
   error and offline states. Each is screenshotted and looked at.
2. **No half-wired UI.** A tab, button or menu item only appears once its data exists. (For example,
   Updates doesn't appear until latest-chapter tracking is live; "More" only lists things that work.)
   No "coming soon" and no dead clicks.
3. **Whatever the phase replaces is removed in the same phase**: old Quick Add, the duplicate
   status/rating/edit controls, and the Refresh Library button once the autopilot exists. Nothing is left
   running in parallel.
4. **Data safety holds:** additive migrations only, user-owned fields out of refresh's reach, a backup
   before any bulk write, and Undo on every write.
5. **Tests and docs land with the code:** Vitest for the pure logic, the UX browser pass, and
   `context/*` plus CLAUDE.md updated by the docs lane.
6. **Performance is no worse:** cold-load JS ≤ 237 KiB gz (baseline 236.9 KiB, measured 2026-09-28 19:18; new code lives in lazy chunks), and the Media route chunk is measured
   before and after.

## Rollout: REPLACE IN PLACE (Rakshit, 2026-09-28)
No beta switch. Each phase changes the live Media page, so every phase gate is strict: build/lint/tsc/Vitest green, a UX browser PASS at 390 + 1440, and only then ship. No phase ships half-done; the page must be fully usable after every ship.

## Lanes and locks
- `notehaven-backend`: migration 28, the edge actions, `media-sources`/`media-match`/`media-link`, Vitest.
- `notehaven-frontend`: SourcePicker, the detail sheet, ProgressControl/LogSheet, extraction, layout.
- `notehaven-ux`: browser verification at each phase gate. `notehaven-docs`: updates `context/*` and
  CLAUDE.md after each phase.
- Locks are disjoint by file, as in batch 1. Nothing is committed until he says ship.

## Verification
- **Unit:** Vitest for match scoring, including the known traps ("Book eating magicians" → the MKR
  manhwa, not the novel; Naruto ≠ Boruto; plural and "The" variants), and for `nextProgress`
  (rollover, clamp).
- **DB:** PGlite fresh build 00→28 plus a re-run; and **against a copy of his export**, the dry-run linker
  gives realistic auto/review/unlinked counts with zero writes.
- **Browser (UX lane, `[audit]` rows only):** add via picker at 390 and 1440; Fix match; pin cover; refresh
  by id is identical twice in a row; Log sheet logs 50 chapters in ≤3 taps; Undo; no horizontal scroll;
  44px targets measured.
- **Prod (with his approval):** SQL-4 coverage before and after, `audit:covers` count going down, and
  cold-load JS unchanged or better (currently 236 KiB gz).
