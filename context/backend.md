# NoteHaven — backend map

There is no application server. The backend is one Supabase project: Postgres with row-level security,
Auth (email + password), Storage (three buckets), Realtime (Notes), RPC functions, and one Deno edge
function, `media-search`. The client reaches everything through the single supabase-js client in
`src/integrations/supabase/client.ts`. Conventions and gotchas are in `CLAUDE.md`; the frontend side is
in `context/frontend.md`.

```
React SPA ──supabase-js──► Supabase: Postgres + RLS · Auth · Storage (vault, avatars, media-covers) · Realtime (notes) · RPC
    │
    ├──fetch + user JWT──► edge function media-search ──► AniList, Jikan, MangaDex, MangaUpdates,
    │                          (service role)                TVmaze, TMDB, Wikidata/Commons, Fanart.tv
    │                          └──upsert──► media_metadata (legacy) · media_source_meta (v2)
    │                          └──cover_copy──► Storage media-covers (E2) · log in media_cover_copies
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
| `media_tracker` | `title`, `type` CHECK (Movie, Series, Anime, Manga, Manhwa, Manhua, KDrama, JDrama), `status` CHECK (Watching, Reading, Plan to Watch, Plan to Read, Completed, **Dropped, On Hold** since 29), `rating` 1–10, `current_season/episode/chapter`, `cover_image`, `release_date`, `last_known_total_episodes/seasons`, `has_new_content` (legacy; nothing reads or writes it since U4), `last_activity_at` · trigram GIN on `title` · upd + activity trigger. **28 and 29 add** the link, latest and reader columns — see "Media v2" below | per-op | 00, 28, 29 | `MediaTracker`, `hooks/media/*`, `lib/media-*`, `simple-image-fetcher`, scripts |
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

### Media v2: source links, history, import and journal (migrations 28–29)

Each tracker entry can be bound once, by search-and-pick, to one source work (`source` + `source_id`).
Refresh then fetches by id instead of re-guessing from the title. **User-owned** fields stay on
`media_tracker` and nothing from a source overwrites them: `title` (the display name), `type`, `status`,
`rating`, progress, tags, `platform`, `resume_url`, `cover_pinned`. **Source-owned** fields live in
`media_source_meta` and are refreshed by id.

| Table / columns | Notes | RLS | File |
|---|---|---|---|
| `media_tracker` + `source` CHECK (anilist, mangaupdates, mangadex, jikan, tmdb, tvmaze), `source_id` TEXT, `alt_ids` JSONB, `link_status` CHECK (unlinked, linked, review) default `unlinked`, `linked_at`, `cover_pinned` BOOL default false, `platform`, `resume_url` (CHECK `^https?://`), `last_known_latest_chapter`, `latest_checked_at`, `latest_changed_at` | `linked` requires `source` + `source_id` (CHECK). Indexes `(user_id, link_status)` and partial `(source, source_id)`. `cover_pinned` = "keep my cover" (pinned with a null cover means "no cover wanted"); linking, sweeps and background fills never replace a pinned cover. `last_known_latest_chapter` / `latest_checked_at` mirror the source's latest chapter on link and on by-id refresh; `latest_changed_at` moves only when a known latest grows (the Updates tab reads it). A stored latest is never lowered | per-op (existing) | 28 |
| `media_tracker` + `reader_latest_chapter`, `reader_checked_at` (the reader app's own latest; **written only by the import**), `cover_origin` CHECK (manual, source, reader, search; NULL = unknown / set before 29; written with every cover by `setCover(s)`, `linkEntry` and the import), `last_known_latest_season` / `last_known_latest_episode` (the source's latest **aired** episode for watch types, written by the library update pass) | N behind = the **higher** of the source's and the reader's latest (`latestOf` in `components/media/progress-view.ts`); shelved titles (Completed, On Hold, Dropped) never show a badge | per-op (existing) | 29 |
| `media_source_meta` | PK `(source, source_id)`. `title`, `alt_titles[]`, `description`, `authors[]`, `genres[]`, `status` CHECK (ongoing, completed, hiatus, cancelled, upcoming), `score` 0–10, `cover`, `banner`, `format`, `medium` CHECK (comic, novel, anime, screen, other), `country`, `year`, `chapters`, `episodes`, `latest_chapter`, `total_seasons`, `seasons`, `episodes_detail`, `cast_members`, `runtime`, `next_airing`, `alt_ids`, `source_url` (CHECK `^https?://`), `fetched_at`. No `user_id`: it's what public APIs publish | public SELECT; **no write policies, and INSERT / UPDATE / DELETE revoked from anon + authenticated** — only the edge function (service role) writes it | 28 |
| `media_progress_log` | `id` identity, `user_id` default `auth.uid()`, `media_id` → `media_tracker` (cascade), `field` CHECK (current_chapter, current_episode, current_season), `from_value`, `to_value`, `season`, `kind` CHECK (log, undo), `origin` (29: NULL = by hand, `tachimanga` = the import), `created_at`. Indexes `(user_id, created_at DESC)`, `(media_id, created_at DESC)` | SELECT own; INSERT own **and** the `media_id` must be the caller's (an EXISTS check, because FK checks bypass RLS); **append-only**: no UPDATE / DELETE policies, and both revoked | 28 |

| `media_link_proposals` | PK `media_id` → `media_tracker` (cascade), `user_id`, staleness snapshot `input_title` / `input_type` / `input_progress`, `band` CHECK (auto, review, none, error, duplicate), `candidates` JSONB (top 3), `sources` JSONB, `resolved_at`, `decision` CHECK (linked, skipped, not_listed), `decided_at`. Written by the "Link your library" resolver (`lib/media-resolve.ts`), one row per unlinked title; a renamed or retyped title is re-proposed, never linked | own rows, all four ops; INSERT / UPDATE also need the caller's `media_id` (EXISTS) | 29 |
| `media_import_map` | PK `(user_id, origin, origin_key)`; `origin` CHECK (tachimanga), `origin_key` = sha256 hex of `source:url` (**no reader title or URL is stored**), `media_id` → `media_tracker` (cascade; many keys may map to one row), `reader_cover` (CHECK `^https?://`), `last_seen_at`. Survives relinks; never stored in `alt_ids` | own rows, all four ops; INSERT / UPDATE need the caller's `media_id` | 29 |
| `media_bulk_journal` | `id`, `user_id`, `batch_id` uuid, `kind` CHECK (link, import, cover), `op` CHECK (update, insert), `media_id` → `media_tracker` (cascade), `before` / `after` JSONB, `created_at`, `undone_at`. Indexes `(user_id, created_at DESC)`, `(batch_id)` | SELECT / INSERT own (+ `media_id` EXISTS); **append-only except marking undone**: an UPDATE policy only from `undone_at IS NULL` to a timestamp, and a column grant on `undone_at` alone; DELETE revoked | 29 |

| `media_cover_copies` | `id`, `user_id`, `media_id` → `media_tracker` (**SET NULL**, so deleting a title can't reset today's cap), `object_key` (CHECK `<sha256>.<ext>`; null when the fetch failed), `source_host`, `bytes` (≤ 2 MB), `deduped`, `failure` (a short code, never a URL; `in_progress` while reserved), `created_at`. Index `(user_id, created_at DESC)`. One row per outbound fetch, failures included | SELECT own; **no write policies, writes revoked**: only the edge function writes it, so a client can't fake or erase its cap | 30 |

All three 29 tables and the 30 log revoke everything from `anon`. Migration 29 is one transaction with a pre-check (it
raises, changing nothing, if any existing status is outside the new list) and `lock_timeout` 5 s.

**One progress writer:** `lib/media-progress-write.ts` `casProgressWrite` (used by
`hooks/media/useProgressMutation.ts` for every tap, the Log sheet and Undo, and by the Tachimanga import).
It does a compare-and-swap UPDATE on `media_tracker` (every changed column matched on the base it planned
from), then a **separate** `media_progress_log` insert once the update confirms. A failed log insert never
blocks or rolls back progress. A lost race re-plans a relative ±N and refuses an explicit target
(`ProgressConflictError`). Undo writes its own `kind = 'undo'` rows and never deletes one. The History tab
only reads the log.

**One bulk journal:** `lib/media-bulk.ts`. Every bulk change (the import, "Link your library" approve as
`kind = 'link'`, and every cover change as `kind = 'cover'`) writes a before / after per row (`writeJournal`) before reporting done. "Undo last bulk
change" (`undoBatch`) is one compare-and-swap restore: `op = 'update'` puts `before` back only where the
row still holds `after`; `op = 'insert'` deletes the row it created under the same guard. Rows changed
since are skipped and counted, never clobbered. Bookkeeping timestamps are restored but not compared
(`UNGUARDED_COLUMNS`), and an entry with no comparable column is refused (`hasGuard`).

**Tachimanga import** (U2b; frontend detail in `context/frontend.md`): parsing and planning happen
**entirely in the browser**. Nothing about the backup reaches the edge function or any log. Approve
writes only his own rows: progress through `casProgressWrite` (History `origin = 'tachimanga'`),
guarded status / cover / reader-latest / platform-if-empty updates, new titles, `media_import_map`
upserts (hash keys + thumbnail URL only), and a `media_bulk_journal` batch for Undo. It never writes
`resume_url`, rating, title or type, and never touches `media_source_meta`.

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
| `media-covers` (30) | **public** URLs; **no** `storage.objects` policies at all (a SELECT policy would let any signed-in client list every key; a public bucket serves its URLs without one). Only the edge function (service role) writes | 2 MB; jpeg, png, webp, gif, avif | `<sha256>.<ext>` (content-hashed, so identical art is stored once; `Cache-Control` 1 year) | edge `cover_copy`; read by every cover `<img>` |
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

> **Deploy state (2026-09-29):** Media v2 shipped. Production runs the v2 function (`search`, `detail`,
> `cover_copy`, `adult.ts`, 2100 ms AniList pacing) from `main` (`5dd396d`), and migrations 28–30 are
> live.

- **Auth:** `verify_jwt = true` in `supabase/config.toml` (sticky server-side, hence declared there),
  and the function also checks the JWT `role`: a signed-in user (`authenticated` with a `sub`) or
  `service_role` (kept for scripts; none calls the function today), so the anon key gets 401. `mediaSearchGet` sends `apikey: <anon key>` and `Authorization: Bearer <session access token>`; it
  returns `null` when there's no session, on a non-2xx response or on a network error, and callers treat
  that as "not found".
- **Dev-only override:** in a dev build, `VITE_MEDIA_SEARCH_URL` (e.g. `http://127.0.0.1:8787`, set in
  `.env.local`) points it at the local function. `import.meta.env.DEV` is a build-time
  constant, so production builds always use `${VITE_SUPABASE_URL}/functions/v1/media-search`.
- **CORS:** `ALLOWED_ORIGINS` (comma-separated secret); unset means `*`. A request from an origin that
  isn't listed gets the first allowed origin echoed back.
- **Legacy paths** (below: `q=` search, `source=` and the batch POST). **Nothing in the repo calls them
  any more**: the app stopped in U4 / U5, and their last caller, `backfill-media-metadata.ts`, was
  deleted. They remain in `index.ts` (and deployed) as dead code.
- **GET** `?q=` (required, truncated to 200 characters) `&type=` `&limit=` (default 10, clamped 1–50)
  `&source=` `&refresh=1`:
  - *search mode* (default): check `media_metadata` (`ilike`, skipped when `refresh` is set), then query
    the sources for the type **in parallel** — anime or untyped: AniList + Jikan + TMDB (tv);
    manga / manhwa / manhua: AniList + Jikan + MangaDex + MangaUpdates; movie / series / kdrama /
    jdrama: TMDB + TVmaze + Wikidata; anything else: AniList + TMDB. Results are de-duplicated and
    ranked by type match, with per-source pacing and one retry on 429.
  - *source mode* (`source=anilist|jikan|mangadex|mangaupdates|tvmaze|tmdb|wikidata|fanart`): one
    source, cache skipped.
  - Response: `{ success, source, query, type, count, results[], duration? }`, where `source` is
    `database`, the named source, a comma-joined list of sources, or `none`.
- **POST** `{ items: [{ id, title, type }] }` (no `q`): batch cover lookup, at most 50 items, of which the
  first 20 cache misses are fetched; returns `{ success, results: [{ id, cover_image }] }`. Nothing in
  the repo calls it today.
- **v2 actions** (`v2.ts`; GET only, chosen by `?action=`; everything the app calls):
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
    or rate-limited). For watch types the detail also carries `next_airing` (with its season) and
    `last_aired` (`{ season, episode, air_date }`: TMDB `last_episode_to_air`, or TVmaze's episode list
    by airstamp, specials skipped; `airedPositions` is pure and Vitest-covered in `v2-aired.test.ts`).
    `last_aired` goes to the client only; `media_source_meta` has no column for it.
  - There is no batch `resolve` action (removed 2026-09-29, BE2). Phase 2's "link your library" will
    call `action=search` in a client-paced loop and score candidates with `src/lib/media-match.ts`.
  - `POST { action: 'cover_copy', items: [{ media_id, url }] }` (at most 10; `cover-copy.ts`, E2): fetches
    an approved cover **once, server-side** (with the Referer its host expects), stores it in the
    `media-covers` bucket and returns the public URL. It never writes `media_tracker`; the client saves
    the returned URL with `setCover`. Guards, all Vitest-covered in `cover-copy.test.ts`:
    - **Allow-list:** only user ids in the `COVER_COPY_USERS` secret (comma-separated); unset or empty =
      nobody (403 `not_enabled`), since sign-up is open and Storage is shared with the Vault.
    - The caller must be a signed-in user who **owns** the `media_id`.
    - **SSRF:** https on the default port only; no credentials, IP literals, localhost / `.local` /
      `.internal` / single-label hosts. The host must resolve, and every address must be public
      (private, loopback, link-local, CGNAT, multicast, reserved and IPv4-mapped are refused); no
      resolution means no fetch. At most 2 redirects, each re-checked.
    - **Content:** an allowed image Content-Type, a hard 2 MB read cutoff, and the type taken from the
      bytes' magic number (renamed HTML or SVG is refused).
    - **Caps**, rolling 24 h, failed fetches included: 300 fetches per user, 1,500 across all users,
      and 150 MB stored across all users. The log row is reserved before the fetch and settled after,
      so if it can't be written nothing is fetched (fails closed).
    - Residual risk, documented: DNS rebinding between resolve and connect. The hosted runtime has no
      route to the private network, and nothing fetched is executed.
  - MangaDex detail and search now return `cover_copy_from` (the 512 px cover-art URL) for the copy
    only; `cover` stays null for MangaDex, since it can't be hotlinked. Not stored in `media_source_meta`.
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
  the top 10 results in search and source modes, and cover-only rows in batch mode. Each site reads the
  existing rows first and **merges** (a sparser hit never downgrades a richer row; a guessed `completed`
  never beats a real status), and upserts only rows that changed. U4 removes these writes. v2 `detail` writes
  `media_source_meta`; v2 `search` writes nothing.
- **Errors:** `{ error }` with 400, 401 or 500; internal details are never returned.
- **Secrets:** `TMDB_API_KEY`, `FANART_API_KEY` (optional), `ALLOWED_ORIGINS`, `COVER_COPY_USERS` (the cover-copy allow-list); `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` come from the runtime.
- **Deploy:** `deploy-edge-function.sh` checks the CLI and login, runs
  `supabase link --project-ref ylefihvjlyzabhvgdnoe` and `supabase functions deploy media-search --use-api` (JWT
  verification comes from `config.toml`), then sets `TMDB_API_KEY`, `FANART_API_KEY` and
  `ALLOWED_ORIGINS` and `COVER_COPY_USERS` from the environment when they're present (an unexported one is left unchanged on
  the server, never cleared). It deploys with `--use-api`, so Docker needn't be running. CI parses the function with esbuild on
  every push (bundling `v2.ts` and `adult.ts` through the import).
- **Local dev** (`npm run edge:dev` → `scripts/edge-dev/serve.ts`): runs the **real** `index.ts` in real
  Deno (pinned `deno@2.9.6` through npx; no Docker, no Supabase CLI) on `127.0.0.1:8787`
  (`EDGE_DEV_PORT` changes it). Three shims: env comes from `.env` (`SUPABASE_URL` falls back to
  `VITE_SUPABASE_URL`; it needs the service-role and anon keys and never prints them); `Deno.serve` is
  pinned to loopback; and `verify_jwt` is emulated by checking each bearer token against
  `/auth/v1/user` (or accepting the service-role key), with a 60 s cache. **It reads the production
  database**, but a fourth shim forces `EDGE_CACHE_WRITES=0`, so it never writes `media_metadata` or
  `media_source_meta` (opt in with `EDGE_DEV_CACHE_WRITES=1`). Writes the app makes through it (progress,
  links, History) are still real production writes.

## Cover images in the client

One judge, one writer (U5):
- **Judge:** `coverVerdict(url, type, origin)` in `lib/cover-medium.ts` → `ok` / `wrong-medium` /
  `blocked` / `unverified`. Provenance (`source`, `manual`, `reader`) only vouches for an unknown host; it
  never excuses a provably wrong medium. It runs at write time, in review counts and in
  `audit:covers`, never at display time.
- **Writer:** `setCover` / `setCovers` in `lib/media-cover.ts`, the only path that changes a cover from
  the app (plus `setCoverPinned` for pinning and `linkEntry`'s own cover rule). A compare-and-swap UPDATE
  guarded on `cover_pinned = false` and the cover he saw; it writes `cover_image` + `cover_origin`,
  journals `kind = 'cover'` in chunks of 5 (write 5 → journal 5), and puts a chunk back if the journal can't be written. A non-manual cover
  that's wrong-medium or blocked is refused.
- **Copy first (E2):** every cover the app saves (a Change cover… pick, a Wrong covers fix, the import's
  reader covers, `linkEntry`'s source art) goes through `copyCover(s)` (`lib/media-cover.ts`) and the
  `urlToSave` rule in `lib/cover-copy.ts`: a successful copy saves the storage URL; `unavailable` (the
  action unreachable) saves the original unless it's **copy-only** art (MangaDex), which is then not
  saved; any other failure saves nothing and says why. Our own copies (`isOwnCoverCopy`) pass through
  unchanged, and covers that already load are left alone.
- **Priority:** a pin always wins → the linked source's art (the default for linked titles) → the reader
  app's thumbnail (`media_import_map.reader_cover`; the default for unlinked ones) → the existing cover if
  it passes → the letter tile. **Web search runs only when he taps "Search the web"** in Change cover….
- **Display** (`lib/simple-image-fetcher.ts`): a **linked** title shows only its stored cover, else
  its source's own art (judged), and never a cover found by title in the legacy cache. Unlinked titles:
  localStorage cache (`lib/image-cache.ts`, 24 h TTL) →
  `media_tracker.cover_image` → `media_metadata` by `(title, type)` (chunked `IN`). It never searches; a
  missing cover stays missing until he picks one.
- `linkEntry` sets `cover_origin = 'source'` when it applies the source's art, only if the title isn't
  pinned and the current cover is missing or fails the judge (or it's a new title, or he accepted the new
  cover); `keepCover` skips it. By-id refresh and the update pass never touch covers.
- Gone: the per-card cover refresh (`media-refresh.ts`), bulk refresh covers, the Refresh Library sweep,
  the legacy `removeCoverImage`, the display-time cover search and `backfill-cover-images.ts`.

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
| `29_media_v2_import_link.sql` | `media_link_proposals`, `media_import_map`, `media_bulk_journal`; 5 `media_tracker` columns (reader latest, cover origin, latest season / episode); `media_progress_log.origin`; the `status` CHECK widened to Dropped / On Hold (found by column, not by name; the only change that isn't an ADD). One transaction; a status pre-check raises before anything changes; ends with a verify SELECT | yes |

| `30_media_covers_bucket.sql` | E2: the public `media-covers` bucket (settings re-asserted on a re-run, so a hand edit can't widen it) with **no storage policies**, and the `media_cover_copies` log. Needs the SQL editor's elevated role (like `vault` / `avatars`). One transaction; verify SELECT expects 0 storage policies mentioning the bucket and 0 without a `bucket_id` filter | yes |

All of `00`–`30` are applied on production (24–27 with fix batch 1; 28 on 2026-09-28; 29 and 30 on
2026-09-29, each ahead of the code that uses it). **Next new file: `31_*.sql`.**

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
| `backfill-release-dates.ts` | cached `media_metadata.episodes_detail` → `media_tracker.release_date` (no network) |
| `backup-media.ts` | `media_tracker`, `media_metadata`, `media_tags`, `media_progress_log`, the three migration 29 tables and `media_cover_copies` (30) → `./backups/<timestamp>/`; a 29 table that doesn't exist yet is noted as "not set up", not a failure. Doesn't include `media_source_meta` (rebuildable from the sources) |
| `backup-vault.ts` | **read-only**: every Vault object's bytes plus `vault_files` / `vault_folders` rows, with SHA-256 manifest and `RESTORE.md` → `./backups/vault-<stamp>/`; orphan objects are backed up and flagged |
| `audit-cover-medium.ts` | reads a local JSON export (no database, no network) and counts covers by `coverVerdict` (`lib/cover-medium.ts`, the same judge the app uses) |
| `audit-metadata-coverage.ts` | read-only coverage report |
| `smoke-media-apis.ts` | the upstream APIs, to check the fields the edge function relies on |
| `link-dry-run.ts` (`npm run link:dry-run`, run with `node --import tsx`) | Media v2 Phase 2 prep. For every `media_tracker` row in a local export, runs the edge function's own `searchAll` **in-process** (same sources, adult filters and pacing) and scores it with `lib/media-match.ts`. The database client it hands the edge code **throws if touched**, so it can't write. Output goes to gitignored `backups/link-dry-run/` (`progress.jsonl` resume log, `summary.json`, `review.md`). Flags: `<export.json>`, `--fresh`, `--rescore` (offline re-score of stored candidates), `--retry-errors`. TMDB titles need `TMDB_API_KEY` |
| `edge-dev/serve.ts` (`npm run edge:dev`, runs in Deno) | the local edge-function server (see "Edge function" above) |
| `make-tachimanga-fixture.ts` (`npx tsx scripts/make-tachimanga-fixture.ts [--variant minimal\|extra] [--pad-chapters N] [--out path]`) | no database, no network: writes a **synthetic** Tachimanga `.tmb` (every title and category invented and prefixed `[audit]`; `--pad-chapters 225000` gives the ~45 MB memory test). Defaults to `$TMPDIR` and **refuses any path inside the repo** |

## Live-database health check

`docs/audit/AUDIT_ONE_SHOT.sql` is a single read-only statement (the SQL editor shows only the last
result set) with 20 sections: row counts, RLS gaps, SECURITY DEFINER hygiene, share policies, tag drift,
vault orphans, ledger integrity, cover hosts, unmasked secrets, unused indexes, auth. Since fix batch 1,
section 13 checks the `ledger_buckets` retirement through the catalog (expect `retired` twice), so the
statement runs again, and the tag checks include `work_project_tags`. It doesn't cover the migration 28
tables yet.
