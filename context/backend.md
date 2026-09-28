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
    │                          └──upsert──► media_metadata
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
| `media_tracker` | `title`, `type` CHECK (Movie, Series, Anime, Manga, Manhwa, Manhua, KDrama, JDrama), `status` CHECK (Watching, Reading, Plan to Watch, Plan to Read, Completed), `rating` 1–10, `current_season/episode/chapter`, `cover_image`, `release_date`, `last_known_total_episodes/seasons`, `has_new_content`, `last_activity_at` · trigram GIN on `title` · upd + activity trigger | per-op | 00 | `MediaTracker`, `lib/media-*`, `simple-image-fetcher`, scripts |
| `code_snippets` | `title`, `code`, `language`, `category`, `folder_id` → `snippet_folders` (SET NULL), `filename`, `description`, `is_favorited`, `is_pinned` · upd | per-op | 00 | `lib/codeSnippets.ts` |
| `snippet_folders` | `name` (unique per user), `color`, `sort_order` · upd. **Also the project list for `commands`** | ALL | 00 | `lib/codeSnippets.ts`, `lib/commands.ts` |
| `commands` | `folder_id` → `snippet_folders` (SET NULL), `category` (free text), `label`, `command`, `description`, `is_favorited`, `is_pinned`, `sort_order` · upd | ALL | 21 | `lib/commands.ts` |
| `user_preferences` | `preference_key`, `preference_value` JSONB; unique `(user_id, preference_key)`. Keys: `dashboard_widgets`, `app_preferences`, `ledger_categories_v2_seeded` · upd | ALL | 00 | `lib/dashboard.ts`, `lib/preferences.ts`, `lib/category-init.ts` |

### Tags

| Table | Notes | RLS | File |
|---|---|---|---|
| `tags` | `name` (unique per user, normalised client-side by `validateTagName`), `color`, `usage_count` | ALL | 00 |
| `note_tags`, `task_tags`, `media_tags`, `prompt_tags` | composite PK `(<entity>_id, tag_id)`, cascades; a trigger maintains `tags.usage_count` | EXISTS (`FOR ALL`) | 00 |
| `code_snippet_tags` (`snippet_id`, `tag_id`) | composite PK, cascades; **no usage-count trigger** | EXISTS (per-op) | 00 |
| `work_project_tags` (`project_id`, `tag_id`) | composite PK, cascades; **no usage-count trigger** | EXISTS (per-op) | 23 |

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
| `shared_notes` | `id` UUID (**the share secret**), `note_id` → notes (cascade), `owner_id`, `allow_edit` | owner only, on `owner_id` | 00 |
| `media_metadata` | **no `user_id` — cross-tenant.** `title` + `type` (unique together; lowercase type CHECK), `cover_image` (nullable), `banner_image`, `description`, `rating`, `status`, `episodes`, `chapters`, `anilist_id`, `mal_id`, `tmdb_id`, `total_seasons`, `seasons`, `genres`, `episodes_detail`, `cast_members`, `runtime`, `last_updated` · trigram GIN on `title` | SELECT for everyone; INSERT / UPDATE `TO authenticated` `WITH CHECK (true)` | 00 |

Share recipients never touch these tables: they use the `get_shared_note` / `update_shared_note` RPCs
below. Every writer of `media_metadata` upserts on `(title, type)`; the edge function writes with the
service role.

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
| `get_shared_note(p_share_id uuid)` | the note's `id`, `title`, `content`, `updated_at`, `allow_edit` | DEFINER, pinned `search_path`; no user check — the share UUID is the credential; granted to anon + authenticated | `SharedNote.tsx` |
| `update_shared_note(p_share_id, p_title?, p_content?)` | rows written (0 when the share is missing or read-only) | same as above | `SharedNote.tsx` |
| `get_calendar_events(p_user_id, p_start_date, p_end_date)` | `event_id, event_type, title, event_date, color, data` across tasks, birthdays (29 Feb handled), subscriptions, countdowns, notes and media release dates | DEFINER, pinned; **raises 42501 unless `p_user_id = auth.uid()`**; authenticated only | `hooks/useCalendar.ts` |
| `get_upcoming_renewals(p_user_id, p_days = 30)` | `id, name, amount, billing_cycle, next_renewal_date, days_until, status`; overdue renewals come back with a negative `days_until` | DEFINER, pinned; same `auth.uid()` check; authenticated only | `lib/subscriptions.ts` `getUpcomingRenewals` ← Dashboard only |
| `get_monthly_ledger_summary(p_user_id, p_year, p_month)` | `total_income, total_expense, net_balance` | INVOKER (RLS scopes it), pinned | `lib/ledger.ts` `getLedgerSummary` |
| `normalize_tag_name(text)`, `cleanup_empty_tags()` | — | INVOKER | nothing calls them |

`show_limit` / `show_trgm` in `types.ts` are pg_trgm internals, not app functions.

## Triggers

| Function | On | Does |
|---|---|---|
| `handle_updated_at` | most tables (every "upd" above) | stamps `updated_at` |
| `update_ledger_entry_timestamp`, `update_subscription_timestamp` | `ledger_entries`, `subscriptions` | stamp `updated_at` |
| `update_tag_usage_count` | `note_tags`, `task_tags`, `media_tags`, `prompt_tags` (insert / delete) | keeps `tags.usage_count` |
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
filtered by `user_id`, and removes it on unmount. `SharedNote` has no realtime. No migration adds
`notes` to the `supabase_realtime` publication — on a new project, enable it in the dashboard.

## Edge function `media-search`

`supabase/functions/media-search/index.ts`; the client helper is `src/lib/edge-function.ts`.

- **Auth:** `verify_jwt = true` in `supabase/config.toml` (sticky server-side, hence declared there),
  and the function also requires the JWT `role` to be `authenticated`, so both the anon key and the
  service-role key get 401. `mediaSearchGet` sends `apikey: <anon key>` and
  `Authorization: Bearer <session access token>`; it returns `null` when there's no session, on a non-2xx
  response or on a network error, and callers treat that as "no cover".
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
- **Writes:** fire-and-forget upserts into `media_metadata` on `(title, type)` with the service role —
  the top 10 results in search and source modes, and cover-only rows in batch mode.
- **Errors:** `{ error }` with 400, 401 or 500; internal details are never returned.
- **Secrets:** `TMDB_API_KEY`, `FANART_API_KEY` (optional), `ALLOWED_ORIGINS`; `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` come from the runtime.
- **Deploy:** `deploy-edge-function.sh` checks the CLI and login, runs
  `supabase link --project-ref ylefihvjlyzabhvgdnoe` and `supabase functions deploy media-search` (JWT
  verification comes from `config.toml`), then sets `TMDB_API_KEY`, `FANART_API_KEY` and
  `ALLOWED_ORIGINS` from the environment when they're present. CI parses the function with esbuild on
  every push.

## Cover images in the client

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
| `00_baseline_schema.sql` | the former migrations 01–19 concatenated verbatim, in their original order (see the section list below). Ends with two verification SELECTs | **no** — re-creates `media_metadata_*` policies without dropping them first ("policy already exists"); **can't bootstrap an empty project today** (section 15 reads `subscriptions.ledger_entry_id` before section 18 adds it) |
| `20_data_cleanup.sql` | blank prompt categories → NULL; delete orphan tags; null out malformed cover URLs; drop `ledger_buckets`, `bucket_id`, `from_bucket_id`, `create_default_ledger_buckets()`; review-only SELECTs for leftover subscription ledger rows and orphan vault objects | **no** — its orphan-tag DELETE predates `work_project_tags` and would delete work-only tags |
| `21_commands.sql` | `commands` table, policy, trigger, indexes | yes |
| `22_security_lint.sql` | pins `get_monthly_ledger_summary`'s `search_path`; revokes EXECUTE on the signup trigger functions; revokes anon on the calendar / renewals RPCs; drops "Avatar public read". Its footer lists the linter warnings accepted by design and two dashboard-only steps | yes |
| `22_wishlist.sql` | `wishlist_items` | yes |
| `23_work_projects.sql` | `work_projects` (GIN on `helped`) and `work_project_tags` | yes |

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

All are run with `tsx` and read `./.env` themselves; everything that touches the database wants
`SUPABASE_SERVICE_ROLE_KEY`, because with the anon key RLS returns no rows. Commands and flags are
listed in `README.md`.

| Script | Talks to |
|---|---|
| `backfill-cover-images.ts` | the upstream APIs **directly**, one item at a time (AniList, Kitsu, Jikan, MangaDex, MangaUpdates, TVmaze, TMDB, OMDB), then `media_tracker.cover_image` |
| `backfill-media-metadata.ts` | the deployed edge function (source mode) → `media_metadata` and `media_tracker.last_known_total_*`. **Fails with 401 today** — it sends no auth header |
| `backfill-release-dates.ts` | cached `media_metadata.episodes_detail` → `media_tracker.release_date` (no network) |
| `backup-media.ts` | `media_tracker`, `media_metadata`, `media_tags` → `./backups/<timestamp>/` |
| `audit-metadata-coverage.ts` | read-only coverage report |
| `smoke-media-apis.ts` | the upstream APIs, to check the fields the edge function relies on |

## Live-database health check

`docs/audit/AUDIT_ONE_SHOT.sql` is a single read-only statement (the SQL editor shows only the last
result set) with 20 sections: row counts, RLS gaps, SECURITY DEFINER hygiene, share policies, tag drift,
vault orphans, ledger integrity, cover hosts, unmasked secrets, unused indexes, auth. **Its section 13
still queries the dropped `ledger_buckets`, so the whole statement fails until that section is removed**,
and its tag checks don't know about `work_project_tags`.
