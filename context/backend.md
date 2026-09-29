# NoteHaven — backend map

There is no application server. The backend is one Supabase project: Postgres with row-level security,
Auth (email + password), Storage (two buckets), Realtime (Notes), RPC functions, and one Deno edge
function, `media-search`. The client reaches everything through the single supabase-js client in
`src/integrations/supabase/client.ts`. Conventions and gotchas are in `CLAUDE.md`; the frontend side is
in `context/frontend.md`.

```
React SPA ──supabase-js──► Supabase: Postgres + RLS · Auth · Storage (vault, avatars) · Realtime (notes) · RPC
    │
    ├──fetch + user JWT──► edge function media-search ──► AniList, Jikan, MangaDex, MangaUpdates,
    │                          (service role)                TVmaze, TMDB, Wikidata/Commons, Fanart.tv
    │                          └──upsert──► media_metadata (legacy) · media_source_meta (v2, not deployed yet)
    └──direct from the browser──► AniList, Kitsu, Jikan, TVmaze (cover refresh) · TheMealDB · Openverse
```

Sources of truth: `supabase/migrations/*.sql` applied in filename order, and
`src/integrations/supabase/types.ts` (generated, then hand-edited).

## Tables

Conventions: `user_id` is `UUID NOT NULL → auth.users ON DELETE CASCADE`; "upd" means a `BEFORE UPDATE`
trigger stamps `updated_at`. RLS styles: **ALL** = one `FOR ALL` policy with
`USING / WITH CHECK (auth.uid() = user_id)`; **per-op** = separate SELECT / INSERT / UPDATE / DELETE
policies; **EXISTS** = junction policies that check ownership of the parent row. The "file" column is
where the table is created (`00` = the baseline).

### Core content

| Table | Columns worth knowing | RLS | File | Used by |
|---|---|---|---|---|
| `tasks` | `task_text`, `is_completed`, `is_pinned`, `due_date` · upd | per-op | 00 | `Tasks`, `Dashboard`, calendar quick-add |
| `notes` | `title`, `content` (HTML), `is_pinned`, `calendar_date`, `background_color` (category key) · upd | per-op, owner only | 00 | `Notes` (+ realtime), `Dashboard`; share RPCs |
| `prompts` | `title`, `prompt_text`, `category`, `is_favorited`, `is_pinned` · **no `updated_at`** | per-op | 00 | `Library`, `Dashboard`, `CommandsTab` |
| `media_tracker` | `title`, `type` CHECK (Movie, Series, Anime, Manga, Manhwa, Manhua, KDrama, JDrama), `status` CHECK (Watching, Reading, Plan to Watch, Plan to Read, Completed), `rating` 1–10, `current_season/episode/chapter`, `cover_image`, `release_date`, `last_known_total_episodes/seasons`, `has_new_content`, `last_activity_at` · trigram GIN on `title` · upd + activity trigger. **28 adds** the link columns — see "Media v2" below | per-op | 00, 28 | `MediaTracker`, `hooks/media/*`, `lib/media-*`, `simple-image-fetcher`, scripts |
| `code_snippets` | `title`, `code`, `language`, `category`, `folder_id` → `snippet_folders` (SET NULL), `filename`, `description`, `is_favorited`, `is_pinned` · upd | per-op | 00 | `lib/codeSnippets.ts` |
| `snippet_folders` | `name` (unique per user), `color`, `sort_order` · upd. **Also the project list for `commands`** | ALL | 00 | `lib/codeSnippets.ts`, `lib/commands.ts` |
| `commands` | `folder_id` → `snippet_folders` (SET NULL), `category` (free text), `label`, `command`, `description`, `is_favorited`, `is_pinned`, `sort_order` · upd | ALL | 21 | `lib/commands.ts` |
| `user_preferences` | `preference_key`, `preference_value` JSONB; unique `(user_id, preference_key)`. Keys: `dashboard_widgets`, `app_preferences`, `ledger_categories_v2_seeded` · upd | ALL | 00 | `lib/dashboard.ts`, `lib/preferences.ts`, `lib/category-init.ts` |

### Tags

| Table | Notes | RLS | File |
|---|---|---|---|
| `tags` | `name` (unique per user, normalised client-side by `validateTagName`), `color`, `usage_count` | ALL | 00 |
| `note_tags`, `task_tags`, `media_tags`, `prompt_tags` | composite PK `(<entity>_id, tag_id)`, cascades; a trigger maintains `tags.usage_count` | EXISTS (`FOR ALL`) | 00 |
| `code_snippet_tags` (`snippet_id`, `tag_id`) | composite PK, cascades; usage-count trigger since 26 | EXISTS (per-op) | 00, 26 |
| `work_project_tags` (`project_id`, `tag_id`) | composite PK, cascades; usage-count trigger since 26 | EXISTS (per-op) | 23, 26 |

All tag reads and writes go through `lib/tags.ts` (`set<Entity>Tags`, `searchByTag`).

### Money

| Table | Columns worth knowing | RLS | File | Used by |
|---|---|---|---|---|
| `ledger_accounts` | `name`, `kind` CHECK (bank, cash, card), `opening_balance`, `color`, `sort_order`, `archived` · upd | ALL | 00 | `lib/accounts.ts` |
| `ledger_categories` | `name`, `type` CHECK (income, expense), `color`, `description`; unique `(user_id, name, type)` | ALL | 00 | `lib/category-init.ts`, `lib/ledger.ts` |
| `ledger_entries` | `amount` ≥ 0, `type` CHECK (income, expense, transfer), `category_id` → categories, `account_id` / `to_account_id` → accounts (all SET NULL), `transaction_date`, `description`, `notes`, `is_recurring`, `recurring_interval` · upd | ALL | 00 | `lib/ledger.ts` |
| `subscription_categories` | `name` (unique per user), `color` | ALL | 00 | `lib/subscriptions.ts`, `lib/category-init.ts` |
| `subscriptions` | `name`, `amount`, `billing_cycle` CHECK (monthly, yearly), `category_id`, `start_date`, `next_renewal_date`, `end_date`, `status` CHECK (active, renew, cancel, cancelled), `notes`, `ledger_category_id`, `ledger_entry_id` (**legacy, always NULL**) · upd | ALL | 00 | `lib/subscriptions.ts`, `lib/ledger.ts` |

Subscriptions write nothing to the ledger. `deriveSubscriptionCharges` (`lib/ledger.ts`) computes the
charges at read time, and `getLedgerSummary` adds them to the RPC totals so the Dashboard and Money
Ledger agree. Money in hand = opening balances + income − expenses − subscription charges
(`lib/accounts.ts`).

### Time-based

| Table | Columns | RLS | File |
|---|---|---|---|
| `birthdays` | `name`, `date_of_birth`; unique `(user_id, name, date_of_birth)`; `user_id` is nullable here | per-op | 00 |
| `countdowns` | `event_name`, `event_date` | ALL | 00 |

### Sharing and the shared media cache

| Table | Notes | RLS | File |
|---|---|---|---|
| `shared_notes` | `id` UUID (**the share secret**), `note_id` → notes (cascade), `owner_id`, `allow_edit` | owner only, on `owner_id`; since 24 `WITH CHECK` also requires `note_id` to be the caller's own note | 00, 24 |
| `media_metadata` | **no `user_id` — cross-tenant.** `title` + `type` (unique together; lowercase type CHECK), `cover_image` (nullable), `banner_image`, `description`, `rating`, `status`, `episodes`, `chapters`, `anilist_id`, `mal_id`, `tmdb_id`, `total_seasons`, `seasons`, `genres`, `episodes_detail`, `cast_members`, `runtime`, `last_updated` · trigram GIN on `title` | SELECT for everyone; INSERT / UPDATE `TO authenticated` `WITH CHECK (true)` | 00 |

Share recipients never touch these tables: they use the `get_shared_note` / `update_shared_note` RPCs
below. Every writer of `media_metadata` upserts on `(title, type)`; the edge function writes with the
service role. Since Media v2 it is the **legacy** cache, used only for unlinked entries.

### Media v2: source links and history (migration 28)

Each tracker entry can be bound once, by search-and-pick, to one source work (`source` + `source_id`).
Refresh then fetches by id instead of re-guessing from the title. **User-owned** fields stay on
`media_tracker` and nothing from a source overwrites them: `title` (the display name), `type`, `status`,
`rating`, progress, tags, `platform`, `resume_url`, `cover_pinned`. **Source-owned** fields live in
`media_source_meta` and are refreshed by id.

| Table / columns | Notes | RLS | File |
|---|---|---|---|
| `media_tracker` + `source` CHECK (anilist, mangaupdates, mangadex, jikan, tmdb, tvmaze), `source_id` TEXT, `alt_ids` JSONB, `link_status` CHECK (unlinked, linked, review) default `unlinked`, `linked_at`, `cover_pinned` BOOL default false, `platform`, `resume_url` (CHECK `^https?://`), `last_known_latest_chapter`, `latest_checked_at`, `latest_changed_at` | `linked` requires `source` + `source_id` (CHECK). Indexes `(user_id, link_status)` and partial `(source, source_id)`. `cover_pinned` = "keep my cover" (pinned with a null cover means "no cover wanted"); linking, sweeps and background fills never replace a pinned cover. `last_known_latest_chapter` / `latest_checked_at` mirror the source's latest chapter on link and on by-id refresh; `latest_changed_at` moves only when the latest grows. Nothing reads it yet: it's for the Phase 3 Updates tab | per-op (existing) | 28 |
| `media_source_meta` | PK `(source, source_id)`. `title`, `alt_titles[]`, `description`, `authors[]`, `genres[]`, `status` CHECK (ongoing, completed, hiatus, cancelled, upcoming), `score` 0–10, `cover`, `banner`, `format`, `medium` CHECK (comic, novel, anime, screen, other), `country`, `year`, `chapters`, `episodes`, `latest_chapter`, `total_seasons`, `seasons`, `episodes_detail`, `cast_members`, `runtime`, `next_airing`, `alt_ids`, `source_url` (CHECK `^https?://`), `fetched_at`. No `user_id`: it's what public APIs publish | public SELECT; **no write policies, and INSERT / UPDATE / DELETE revoked from anon + authenticated** — only the edge function (service role) writes it | 28 |
| `media_progress_log` | `id` identity, `user_id` default `auth.uid()`, `media_id` → `media_tracker` (cascade), `field` CHECK (current_chapter, current_episode, current_season), `from_value`, `to_value`, `season`, `kind` CHECK (log, undo), `created_at`. Indexes `(user_id, created_at DESC)`, `(media_id, created_at DESC)` | SELECT own; INSERT own **and** the `media_id` must be the caller's (an EXISTS check, because FK checks bypass RLS); **append-only**: no UPDATE / DELETE policies, and both revoked | 28 |

The progress writer (`hooks/media/useProgressMutation.ts`) does a compare-and-swap UPDATE on
`media_tracker`, then a **separate** log insert once the update confirms. A failed log insert never
blocks or rolls back the progress write. Undo inserts its own `kind = 'undo'` row and never deletes one.
The History tab only reads this table.

### Vault, lifestyle, work

| Table | Columns worth knowing | RLS | File | Used by |
|---|---|---|---|---|
| `vault_folders` | `parent_id` → self (cascade; NULL = root), `name`, `color`, `sort_order`; `UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name)` (PG15+) · upd | ALL | 00 | `lib/vault.ts` |
| `vault_files` | `folder_id` → folders (cascade), `name`, `storage_path`, `mime_type`, `size_bytes`, `is_starred` · upd. Metadata only; bytes live in Storage | ALL | 00 | `lib/vault.ts`, Settings → Data |
| `bucket_list` | `title`, `description`, `category`, `status` CHECK (dreaming, planned, achieved), `image_url`, `target_date`, `achieved_at`, `sort_order` · upd | ALL | 00 | `lib/bucket-list.ts` |
| `recipe_folders` | `name`, `sort_order` | ALL | 00 | `lib/recipes.ts` |
| `recipes` | `folder_id` (SET NULL), `title`, `description`, `image_url`, `cuisine`, `category`, `ingredients` JSONB (string array), `instructions`, `prep_minutes`, `cook_minutes`, `servings`, `difficulty` CHECK (easy, medium, hard), `source_url`, `is_favorite`, `sort_order` · upd | ALL | 00 | `lib/recipes.ts` |
| `wishlist_items` | `user_id` DEFAULT `auth.uid()`, `name`, `url`, `current_price`, `target_price`, `notes`, `status` CHECK (active, purchased, archived), `price_history` JSONB array, `price_drop_notified_at` · upd | ALL | 22_wishlist | `lib/wishlist.ts` |
| `work_projects` | `user_id` DEFAULT `auth.uid()`, `name`, `helped` **TEXT[]** (GIN), `description`, `month` (first of month), `duration_value` > 0 + `duration_unit` CHECK (days, weeks, months), `hours` ≥ 0, `team`, `link`, `status` CHECK (active, delivered, on_hold) · upd | ALL | 23 | `lib/work.ts` |

Not tables: the recipe pantry (`localStorage.recipesPantry`) and command "projects" (they reuse
`snippet_folders`). `ledger_buckets` was dropped by migration 20.

## RPC functions

| Function | Returns | Security | Called by |
|---|---|---|---|
| `get_shared_note(p_share_id uuid)` | the note's `id`, `title`, `content`, `updated_at`, `allow_edit` | DEFINER, pinned `search_path`; no user check — the share UUID is the credential; granted to anon + authenticated. Since 24 it joins on `notes.user_id = shared_notes.owner_id`, so a share row pointing at someone else's note returns nothing | `SharedNote.tsx` |
| `update_shared_note(p_share_id, p_title?, p_content?)` | rows written (0 when the share is missing, read-only, or not the owner's note) | same as above | `SharedNote.tsx` |
| `get_calendar_events(p_user_id, p_start_date, p_end_date)` | `event_id, event_type, title, event_date, color, data` across tasks, birthdays, subscriptions, countdowns, notes and media release dates. Since 25: birthdays are generated once per year in the range (January views work, 29 Feb safe), and active monthly / yearly subscriptions project every renewal in the range (`event_id` `subscription_<id>_<k>`), computed on read | DEFINER, pinned; **raises 42501 unless `p_user_id = auth.uid()`**; authenticated only | `hooks/useCalendar.ts` |
| `get_upcoming_renewals(p_user_id, p_days = 30)` | `id, name, amount, billing_cycle, next_renewal_date, days_until, status`; overdue renewals come back with a negative `days_until` | DEFINER, pinned; same `auth.uid()` check; authenticated only | `lib/subscriptions.ts` `getUpcomingRenewals` ← Dashboard only |
| `get_monthly_ledger_summary(p_user_id, p_year, p_month)` | `total_income, total_expense, net_balance` | INVOKER (RLS scopes it), pinned | `lib/ledger.ts` `getLedgerSummary` |
| `normalize_tag_name(text)`, `cleanup_empty_tags()` | — | INVOKER | nothing calls them |

`show_limit` / `show_trgm` in `types.ts` are pg_trgm internals, not app functions.

## Triggers

| Function | On | Does |
|---|---|---|
| `handle_updated_at` | most tables (every "upd" above) | stamps `updated_at` |
| `update_ledger_entry_timestamp`, `update_subscription_timestamp` | `ledger_entries`, `subscriptions` | stamp `updated_at` |
| `update_tag_usage_count` | all six junctions (insert / delete); `code_snippet_tags` and `work_project_tags` since 26, which also recounted every tag once | keeps `tags.usage_count` |
| `media_tracker_touch_activity` | `media_tracker` update | bumps `last_activity_at` only when progress, rating or status changes |
| `create_default_ledger_categories`, `create_default_subscription_categories` | `auth.users` insert | seed default categories (DEFINER; EXECUTE revoked from clients). The client seeds its own newer ledger set once, behind the `ledger_categories_v2_seeded` flag |

## Storage

| Bucket | Access | Limits | Path | Used by |
|---|---|---|---|---|
| `vault` | **private**; one owner-only policy on `storage.objects` (`(storage.foldername(name))[1] = auth.uid()::text`) | 25 MB per file | `{user_id}/{uuid}.{ext}` | `lib/vault.ts` |
| `avatars` | **public** URLs; owner INSERT / UPDATE / DELETE (the public-read policy was dropped by `22_security_lint`) | 5 MB; png, jpeg, webp, gif | `{user_id}/avatar.{ext}` | `settings/AccountSection.tsx` (URL saved in the auth user's `avatar_url` metadata) |

Vault rules: the folder tree lives in the database, so moving a file is a one-row `UPDATE` and the
storage path never changes. There are no share links — preview and download mint short-lived signed
URLs (10 min preview, 2 min download). `deleteFolder` collects the subtree's storage paths, deletes the
folder row (cascading the file rows), then removes the objects.

## Realtime

One subscriber: `Notes.tsx` opens `channel('notes-changes')` for `postgres_changes` on `public.notes`,
filtered by `user_id`, and removes it on unmount. `SharedNote` has no realtime. `27_notes_realtime.sql`
adds `notes` to the `supabase_realtime` publication (idempotent; `REPLICA IDENTITY` left at default).

## Edge function `media-search`

`supabase/functions/media-search/index.ts` (legacy paths + routing), `v2.ts` (the Media v2 actions),
`adult.ts` (the shared explicit-content filter, pure, covered by `adult.test.ts` under Vitest). The
client helpers are in `src/lib/edge-function.ts`.

> **Deploy state (2026-09-29):** production runs `main`'s version. The v2 actions, `adult.ts` and the
> 2100 ms AniList pacing exist only on the `media-v2` branch. They go live in **one** redeploy when
> Media v2 Phase 1 ships. Until then, only `npm run edge:dev` serves them.

- **Auth:** `verify_jwt = true` in `supabase/config.toml` (sticky server-side, hence declared there),
  and the function also checks the JWT `role`: a signed-in user (`authenticated` with a `sub`) or
  `service_role` (the maintenance scripts), so the anon key gets 401. `mediaSearchGet` /
  `mediaSearchPost` send `apikey: <anon key>` and `Authorization: Bearer <session access token>`; they
  return `null` when there's no session, on a non-2xx response or on a network error, and callers treat
  that as "not found".
- **Dev-only override:** in a dev build, `VITE_MEDIA_SEARCH_URL` (e.g. `http://127.0.0.1:8787`, set in
  `.env.local`) points both helpers at the local function. `import.meta.env.DEV` is a build-time
  constant, so production builds always use `${VITE_SUPABASE_URL}/functions/v1/media-search`.
- **CORS:** `ALLOWED_ORIGINS` (comma-separated secret); unset means `*`. A request from an origin that
  isn't listed gets the first allowed origin echoed back.
- **GET** `?q=` (required, truncated to 200 characters) `&type=` `&limit=` (default 10, clamped 1–50)
  `&source=` `&refresh=1`:
  - *search mode* (default): check `media_metadata` (`ilike`, skipped when `refresh` is set), then query
    the sources for the type **in parallel** — anime or untyped: AniList + Jikan + TMDB (tv);
    manga / manhwa / manhua: AniList + Jikan + MangaDex + MangaUpdates; movie / series / kdrama /
    jdrama: TMDB + TVmaze + Wikidata; anything else: AniList + TMDB. Results are de-duplicated and
    ranked by type match, with per-source pacing and one retry on 429.
  - *source mode* (`source=anilist|jikan|mangadex|mangaupdates|tvmaze|tmdb|wikidata|fanart`): one
    source, cache skipped. `media-refresh.ts` uses it for TMDB, Wikidata and Fanart so those keys stay
    server-side.
  - Response: `{ success, source, query, type, count, results[], duration? }`, where `source` is
    `database`, the named source, a comma-joined list of sources, or `none`.
- **POST** `{ items: [{ id, title, type }] }` (no `q`): batch cover lookup, at most 50 items, of which the
  first 20 cache misses are fetched; returns `{ success, results: [{ id, cover_image }] }`. Nothing in
  the repo calls it today.
- **v2 actions** (`v2.ts`; chosen by `?action=` on GET, or `{ action }` in a POST body; the legacy paths
  above are untouched and still serve unlinked entries):
  - `GET ?action=search&q&type&limit` (limit default 8, clamped 1–10): fans out to the **type-correct**
    sources only — manhwa: AniList + MangaUpdates + MangaDex; manhua: MangaUpdates + AniList + MangaDex;
    manga: AniList + Jikan + MangaUpdates; anime: AniList + Jikan; series / kdrama / jdrama: TMDB +
    TVmaze; movie: TMDB. Returns `{ candidates[], sources[] }`: each candidate carries its own
    `source` + `source_id`, and each source reports `ok | empty | error | rate_limited | unavailable`.
    **Persists nothing.**
  - `GET ?action=detail&source&id&type`: fetches one work by id (AniList `Media(id)`, MangaUpdates
    `/v1/series/{id}`, MangaDex `/manga/{uuid}` + `/aggregate` for the latest chapter, Jikan `/full`,
    TMDB with credits, TVmaze with embedded episodes and cast), **upserts `media_source_meta`** on
    `(source, source_id)`, and returns the normalised detail (`detail: null` + `error` when not found
    or rate-limited).
  - `POST { action: 'resolve', items: [{ id, title, type }] }` (at most 10 items): up to 5 candidates per
    item, for "link your library". The **client** scores them (`src/lib/media-match.ts`); the function
    doesn't.
  - Guarantees the client relies on: unknown values are `null` (never `0`, `''` or `'upcoming'`),
    statuses are normalised to the `media_source_meta` vocabulary, adult works are excluded at the
    source (AniList `isAdult: false`, Jikan `sfw`, TMDB `include_adult=false`, MangaDex content rating
    safe / suggestive, MangaUpdates `exclude_genre`) and re-checked on the by-id path, and MangaDex covers
    are never hotlinked (returned as `null`).
- **Adult filter** (`adult.ts`, `hasAdultGenre`): also drops explicit rows from `media_metadata` cache
  hits and from batch-mode cache hits, since rows cached before the filters existed can still be
  explicit.
- **Pacing:** `SOURCE_SPACING_MS` per upstream; AniList is **2100 ms** (it runs at a reduced 30 req/min),
  Jikan 400, Wikidata 300, MangaDex / MangaUpdates / TVmaze / Fanart 250, TMDB 60.
- **Writes:** fire-and-forget upserts into `media_metadata` on `(title, type)` with the service role —
  the top 10 results in search and source modes, and cover-only rows in batch mode. v2 `detail` writes
  `media_source_meta`; v2 `search` and `resolve` write nothing.
- **Errors:** `{ error }` with 400, 401 or 500; internal details are never returned.
- **Secrets:** `TMDB_API_KEY`, `FANART_API_KEY` (optional), `ALLOWED_ORIGINS`; `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` come from the runtime.
- **Deploy:** `deploy-edge-function.sh` checks the CLI and login, runs
  `supabase link --project-ref ylefihvjlyzabhvgdnoe` and `supabase functions deploy media-search` (JWT
  verification comes from `config.toml`), then sets `TMDB_API_KEY`, `FANART_API_KEY` and
  `ALLOWED_ORIGINS` from the environment when they're present. CI parses the function with esbuild on
  every push (bundling `v2.ts` and `adult.ts` through the import).
- **Local dev** (`npm run edge:dev` → `scripts/edge-dev/serve.ts`): runs the **real** `index.ts` in real
  Deno (pinned `deno@2.9.6` through npx; no Docker, no Supabase CLI) on `127.0.0.1:8787`
  (`EDGE_DEV_PORT` changes it). Three shims: env comes from `.env` (`SUPABASE_URL` falls back to
  `VITE_SUPABASE_URL`; it needs the service-role and anon keys and never prints them); `Deno.serve` is
  pinned to loopback; and `verify_jwt` is emulated by checking each bearer token against
  `/auth/v1/user` (or accepting the service-role key), with a 60 s cache. **It runs against the
  production database**, so its cache writes (`media_metadata`, `media_source_meta`) are real.

## Cover images in the client

Linked entries (Media v2) get their cover from `linkEntry` in `lib/media-link.ts`: never when
`cover_pinned`; for a new entry, or when the current cover is missing or fails `isUsableCover`, or when
the user accepts "use new cover". By-id refresh (`refreshLinked`) never touches the cover. Everything
below is the path for **unlinked** entries. Every path refuses wrong-medium art (`lib/cover-medium.ts`
`isUsableCover`: a donghua poster on a manhua, a TV poster on a manhwa, MangaDex hotlinks), and search
hits must match the typed title (`lib/title-match.ts`, bigram Dice ≥ `TITLE_MATCH_MIN` 0.6).

- `lib/simple-image-fetcher.ts` `fetchImagesFromSupabase(items)`: localStorage cache
  (`lib/image-cache.ts`, 24 h TTL) → `media_tracker.cover_image` → `media_metadata` by `(title, type)`
  (both as `IN` queries chunked at 100) → the edge function for what's still missing, 10 at a time with
  100 ms between batches. Returns `{ found, notFound, fetchedFromAPI, results[] }`.
- `lib/media-refresh.ts` `refreshCoverImage(title, type, currentApiSource, mediaId)`: each type has a
  source priority list and each click moves on to the next source. It writes the new cover to
  `media_tracker` (by id) and `media_metadata` (upsert), then invalidates the cache entry. MangaDex and
  MangaUpdates are deliberately left out (no browser CORS).
- `lib/media-metadata.ts` `refreshLibrary`: the Refresh Library sweep, run through
  `RefreshActivityContext`. It fills missing covers and metadata only, and never writes personal progress.

## Migrations

Applied by hand in the Supabase SQL editor, in filename order. There is no runner: `supabase db push`
would trip over the two `22_` files, and `00` inserts into `storage.buckets`, which needs the editor's
privileges.

| File | What it does | Safe to re-run? |
|---|---|---|
| `00_baseline_schema.sql` | the former migrations 01–19 concatenated verbatim, in their original order (see the section list below). Ends with two verification SELECTs. Amended 2026-09-28 (B-02): section 15 now creates the two subscription columns it reads, so it **builds a fresh project** | **no** — re-creates `media_metadata_*` policies without dropping them first ("policy already exists"), and if forced it would re-create the `ledger_buckets` that 20 dropped |
| `20_data_cleanup.sql` | blank prompt categories → NULL; delete orphan tags; null out malformed cover URLs; drop `ledger_buckets`, `bucket_id`, `from_bucket_id`, `create_default_ledger_buckets()`; review-only SELECTs for leftover subscription ledger rows and orphan vault objects | **no** — its orphan-tag DELETE predates `work_project_tags` and would delete work-only tags |
| `21_commands.sql` | `commands` table, policy, trigger, indexes | yes |
| `22_security_lint.sql` | pins `get_monthly_ledger_summary`'s `search_path`; revokes EXECUTE on the signup trigger functions; revokes anon on the calendar / renewals RPCs; drops "Avatar public read". Its footer lists the linter warnings accepted by design and two dashboard-only steps | yes |
| `22_wishlist.sql` | `wishlist_items` | yes |
| `23_work_projects.sql` | `work_projects` (GIN on `helped`) and `work_project_tags` | yes |
| `24_share_owner_check.sql` | share IDOR fix (B-01): both share RPCs join the note to the share's owner; `shared_notes` `WITH CHECK` requires the caller's own note. A clean-up DELETE of foreign share rows is left **commented out** | yes |
| `25_calendar_events_fixes.sql` | `get_calendar_events`: birthdays across New Year, and projected subscription renewals (read-only) | yes |
| `26_tag_usage_triggers.sql` | usage-count triggers on `code_snippet_tags` and `work_project_tags`, plus a one-time recount (writes only rows whose count is wrong) | yes |
| `27_notes_realtime.sql` | adds `notes` to `supabase_realtime` (checks `pg_publication_tables` first) | yes |
| `28_media_source_links.sql` | Media v2: 11 link / latest columns on `media_tracker`, `media_source_meta`, `media_progress_log` (see "Media v2" above). **Additive only**; ends with a verify SELECT (expect 11, true, true) | yes |

All of `00`–`28` are applied on production (24–27 with fix batch 1; 28 on 2026-09-28, ahead of the
Media v2 code that uses it). **Next new file: `29_*.sql`.**

`00` sections: 01 core tables · 02 tags, ledger, subscriptions, birthdays, countdowns, shared notes,
snippets, calendar RPC · 03 `media_metadata` · 04 `user_preferences` · 05 `cover_image` + pg_trgm ·
06 ledger buckets (dropped by 20) · 07 snippet folders · 08 metadata seasons / genres + new-content
columns · 09 episode detail, cast, runtime · 10 Vault tables + bucket · 11a `last_activity_at` · 11b
avatars bucket · 12 signup triggers as DEFINER · 13 ledger accounts · 14 nullable `cover_image` · 15 drop
the subscription → ledger triggers · 16 bucket list · 17 recipes · 18 drift reconcile · 19 security
hardening (share RPCs, `auth.uid()` checks, pinned `search_path`s, authenticated-only `media_metadata`
writes).

**Accepted by design** (`22_security_lint.sql` footer): anon may call the two share RPCs;
`media_metadata` writes are `WITH CHECK (true)` for authenticated users; pg_trgm stays in `public`.
**Dashboard-only steps:** leaked-password protection, and the pending Postgres security patch.

## Maintenance scripts (`scripts/`)

All run with `tsx` (except `edge-dev`, which runs in Deno) and read `./.env`; everything that touches the database wants
`SUPABASE_SERVICE_ROLE_KEY`, because with the anon key RLS returns no rows. Commands and flags are
listed in `README.md`.

| Script | Talks to |
|---|---|
| `backfill-cover-images.ts` | the upstream APIs **directly**, one item at a time (AniList, Kitsu, Jikan, MangaDex, MangaUpdates, TVmaze, TMDB, OMDB), then `media_tracker.cover_image` |
| `backfill-media-metadata.ts` | the deployed edge function (source mode), authenticated with the service-role key (which the function accepts since fix batch 1) → `media_metadata` and `media_tracker.last_known_total_*` |
| `backfill-release-dates.ts` | cached `media_metadata.episodes_detail` → `media_tracker.release_date` (no network) |
| `backup-media.ts` | `media_tracker`, `media_metadata`, `media_tags` → `./backups/<timestamp>/`. Doesn't include `media_source_meta` or `media_progress_log` |
| `backup-vault.ts` | **read-only**: every Vault object's bytes plus `vault_files` / `vault_folders` rows, with SHA-256 manifest and `RESTORE.md` → `./backups/vault-<stamp>/`; orphan objects are backed up and flagged |
| `audit-cover-medium.ts` | reads a local JSON export (no database, no network) and lists covers that are provably the wrong medium (`lib/cover-medium.ts`) |
| `audit-metadata-coverage.ts` | read-only coverage report |
| `smoke-media-apis.ts` | the upstream APIs, to check the fields the edge function relies on |
| `link-dry-run.ts` (`npm run link:dry-run`, run with `node --import tsx`) | Media v2 Phase 2 prep. For every `media_tracker` row in a local export, runs the edge function's own `searchAll` **in-process** (same sources, adult filters and pacing) and scores it with `lib/media-match.ts`. The database client it hands the edge code **throws if touched**, so it can't write. Output goes to gitignored `backups/link-dry-run/` (`progress.jsonl` resume log, `summary.json`, `review.md`). Flags: `<export.json>`, `--fresh`, `--rescore` (offline re-score of stored candidates), `--retry-errors`. TMDB titles need `TMDB_API_KEY` |
| `edge-dev/serve.ts` (`npm run edge:dev`, runs in Deno) | the local edge-function server (see "Edge function" above) |

## Live-database health check

`docs/audit/AUDIT_ONE_SHOT.sql` is a single read-only statement (the SQL editor shows only the last
result set) with 20 sections: row counts, RLS gaps, SECURITY DEFINER hygiene, share policies, tag drift,
vault orphans, ledger integrity, cover hosts, unmasked secrets, unused indexes, auth. Since fix batch 1,
section 13 checks the `ledger_buckets` retirement through the catalog (expect `retired` twice), so the
statement runs again, and the tag checks include `work_project_tags`. It doesn't cover the migration 28
tables yet.
