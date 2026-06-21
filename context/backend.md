# NoteHaven — Backend Context

> NoteHaven has **no traditional backend server**. The "backend" is Supabase: PostgreSQL (with Row Level Security), Supabase Auth, Realtime, Postgres RPC functions, and a single Edge Function for media search. The React client talks to Supabase directly via `@supabase/supabase-js`.

---

## 1. Architecture

```
React SPA  ──(supabase-js: auth, from(), rpc(), realtime)──►  Supabase
   │                                                            ├─ PostgreSQL + RLS
   │                                                            ├─ Auth (email/password)
   │                                                            ├─ Realtime (notes sync, shared notes)
   │                                                            └─ RPC functions
   └──(fetch / axios)──►  Edge Function: media-search  ──►  External APIs
                                                            (AniList, Jikan, Kitsu,
                                                             MangaUpdates, TMDB, OMDB)
```

There is also a Node script (`scripts/backfill-cover-images.ts`) run locally with the service-role key to backfill `media_tracker.cover_image`.

> The backend source lives in the git-tracked `supabase/` folder: `supabase/config.toml`, `supabase/functions/media-search/index.ts`, and five SQL migrations under `supabase/migrations/`. The schema below reflects those migrations and matches the generated client types in `src/integrations/supabase/types.ts`. (`supabase/.temp/` is CLI cache and is untracked.)

### Migration files (`supabase/migrations/`)
1. `01_create_base_schema.sql` — core tables (`tasks`, `notes`, `prompts`, `media_tracker`), RLS policies (separate per-operation policies), `handle_updated_at` trigger, base indexes.
2. `02_add_all_features.sql` — tags + junctions (+ usage-count triggers), money ledger (+ default-categories trigger on signup, monthly-summary fn), subscriptions (+ default categories, **auto-ledger-entry trigger**, upcoming-renewals fn), birthdays, countdowns, shared notes (+ share-based note read/update policies using `current_setting('app.share_id')`), code snippets, and the `get_calendar_events` function.
3. `03_create_media_metadata.sql` — public `media_metadata` cache (public read; insert/update open to service role).
4. `04_create_user_preferences.sql` — `user_preferences` (dashboard layout etc.).
5. `05_add_cover_image_and_search_index.sql` — adds `media_tracker.cover_image`, enables `pg_trgm`, backfills covers from `media_metadata`, adds GIN trigram indexes on titles.
6. `06_add_ledger_buckets.sql` — adds `ledger_buckets` (+ RLS, `updated_at` trigger), `bucket_id`/`from_bucket_id` on `ledger_entries`, and relaxes the `type` CHECK to allow `'transfer'`.

---

## 2. Supabase Client (`src/integrations/supabase/client.ts`)

```ts
createClient<Database>(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true }
});
```

- Reads `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Dev-only warning if missing; in prod it constructs with empty strings (calls then fail at runtime).
- Single shared client instance imported everywhere as `supabase`.
- Typed against the generated `Database` type in `types.ts`.

Project ref seen in `deploy-edge-function.sh`: `ylefihvjlyzabhvgdnoe`.

---

## 3. Database Schema (from `types.ts`)

All user tables key off `auth.uid()` via a `user_id` column and are expected to use RLS (`auth.uid() = user_id`). `media_metadata` is the public/shared exception.

### Core content tables

**`notes`**
- `id` (bigint PK), `user_id`, `title`, `content` (HTML), `is_pinned` (bool), `background_color` (category color string, nullable), `calendar_date` (nullable), `created_at`, `updated_at`.

**`tasks`**
- `id`, `user_id`, `task_text`, `is_completed`, `is_pinned`, `due_date` (nullable), `created_at`, `updated_at`.

**`prompts`**
- `id`, `user_id`, `title` (nullable), `prompt_text`, `category` (nullable), `is_favorited`, `is_pinned`, `created_at`.

**`code_snippets`**
- `id`, `user_id`, `title`, `code`, `language`, `category` (nullable), `is_favorited`, `is_pinned`, `created_at`, `updated_at`.

**`media_tracker`**
- `id`, `user_id`, `title`, `type` (Movie/Series/Anime/Manga/Manhwa/Manhua/KDrama/JDrama), `status` (Watching/Reading/Plan to Watch/Plan to Read/Completed), `rating`, `current_season`, `current_episode`, `current_chapter`, `cover_image` (nullable), `release_date`, `created_at`, `updated_at`.

### Tagging (many-to-many)

**`tags`**: `id`, `user_id`, `name` (normalized lowercase), `color` (hex), `usage_count`, `created_at`.

Junction tables (composite PK `(<entity>_id, tag_id)`, FKs to entity + `tags`):
- `note_tags` (note_id, tag_id)
- `task_tags` (task_id, tag_id)
- `media_tags` (media_id, tag_id)
- `prompt_tags` (prompt_id, tag_id)
- `code_snippet_tags` (snippet_id, tag_id)

`usage_count` is maintained server-side (the client relies on it for sorting and `canDeleteTag`); a `cleanup_empty_tags` function exists. Comments in `tags.ts` mention tags auto-cleanup via trigger.

### Finance

**`ledger_categories`**: `id`, `user_id`, `name`, `type` ('income'|'expense'), `color`, `description`, `created_at`.

**`ledger_entries`**: `id`, `user_id`, `category_id` (FK), `type` ('income'|'expense'|'transfer'), `amount` (numeric), `description`, `notes`, `transaction_date` (date), `is_recurring`, `recurring_interval`, `bucket_id` (FK→ledger_buckets), `from_bucket_id` (FK→ledger_buckets, transfers only), `created_at`, `updated_at`.

**`ledger_buckets`** (migration 06 — envelope budgeting): `id`, `user_id`, `name`, `kind` ('spending'|'saving'|'obligation'|'liability'), `color`, `target_amount` (nullable goal), `notes`, `sort_order`, `created_at`, `updated_at`. Income allocated to / expenses drawn from a bucket; `transfer` entries move between `from_bucket_id`→`bucket_id`. Balances computed client-side in `lib/buckets.ts`.

**`subscription_categories`**: `id`, `user_id`, `name`, `color`, `created_at`.

**`subscriptions`**: `id`, `user_id`, `name`, `amount`, `billing_cycle` ('monthly'|'yearly'), `category_id` (FK), `start_date`, `end_date`, `next_renewal_date`, `status` (active/renew/cancel/cancelled), `notes`, `ledger_category_id` (FK), `ledger_entry_id` (FK to the auto-created ledger row), `created_at`, `updated_at`.
- A DB trigger keeps a linked `ledger_entries` row in sync (create/update/delete) — documented in `lib/subscriptions.ts`.

### Time-based / misc

**`birthdays`**: `id`, `user_id`, `name`, `date_of_birth` (date), `created_at`.

**`countdowns`**: `id`, `user_id`, `event_name`, `event_date`, `created_at`.

**`shared_notes`**: `id` (uuid PK), `note_id` (FK → notes), `owner_id`, `allow_edit` (bool), `created_at`. Powers public `/notes/share/:id`.

**`user_preferences`**: `id` (uuid), `user_id`, `preference_key`, `preference_value` (jsonb), timestamps. Unique on `(user_id, preference_key)`. Currently stores `dashboard_widgets`.

### Public metadata (shared, read-only to all)

**`media_metadata`**: `id`, `title`, `type`, `cover_image` (required), `banner_image`, `description`, `rating`, `episodes`, `chapters`, `status`, `anilist_id`, `mal_id`, `tmdb_id`, `created_at`, `last_updated`. Upserts conflict on `(title, type)`. README notes ~653 pre-cached items. Read policy is public; this is the cover-image cache shared across users.

---

## 4. Postgres RPC Functions (callable via `supabase.rpc`)

| Function | Args | Returns | Used by |
|---|---|---|---|
| `get_calendar_events` | `p_user_id`, `p_start_date`, `p_end_date` | rows `{event_id, event_type, title, event_date, color, data}` | `hooks/useCalendar.ts` (unified calendar) |
| `get_monthly_ledger_summary` | `p_user_id`, `p_year`, `p_month` | `{total_income, total_expense, net_balance}` | `lib/ledger.ts → getLedgerSummary` |
| `get_upcoming_renewals` | `p_user_id`, `p_days?` | renewal rows incl. `days_until` | `lib/subscriptions.ts → getUpcomingRenewals` |
| `cleanup_empty_tags` | — | void | tag maintenance (placeholder client call) |
| `normalize_tag_name` | `tag_name` | text | tag normalization (server side) |
| `show_limit`, `show_trgm` | — | trigram helpers (pg_trgm) | search support |

`get_calendar_events` is the backbone of the Calendar page — it merges all time-based entities server-side and returns a typed, colored event stream.

---

## 5. Row Level Security (from migrations)

Every user table enables RLS and scopes by `auth.uid() = user_id`. Two policy styles are used:
- **Base tables** (`tasks`, `notes`, `prompts`, `media_tracker`, `code_snippets`): separate per-operation policies (`SELECT`/`INSERT`/`UPDATE`/`DELETE`).
- **Feature tables** (`tags`, `ledger_*`, `subscription_*`, `countdowns`, `birthdays`, `user_preferences`): a single `FOR ALL` policy with `USING` + `WITH CHECK`.
- **Junction tables** (`note_tags`, etc.): policies check ownership of the parent row via an `EXISTS` subquery.

```sql
-- typical FOR ALL policy
CREATE POLICY "Users can manage their own data"
  ON <table> FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- public read (media_metadata) — insert/update intentionally open (service role / edge fn)
CREATE POLICY "Allow public read access" ON media_metadata FOR SELECT USING (true);
```

**Shared notes** use a session-variable mechanism: `shared_notes` has owner-full-access + public `SELECT`. `notes` then gets `notes_select_via_share` / `notes_update_via_share` policies that match when `shared_notes.id = current_setting('app.share_id')::uuid` (and `allow_edit` for updates). Note: the `SharedNote.tsx` client reads via the anon key relying on `shared_notes_public_read` + the share-scoped note policies.

---

## 6. Edge Function: `media-search`

Deployed at `${VITE_SUPABASE_URL}/functions/v1/media-search`. Deployed with `--no-verify-jwt` (anonymous access).

**Query params (GET)**: `q` (required), `type` (anime/manga/movie/series/kdrama/jdrama/…), `limit` (default 10).
**Also supports POST** with `{ items: [{id, title, type}] }` for batch lookups (used by the backfill script).

**Response shape** (consumed by the client):
```ts
{ success: boolean, query, type, count, results: ExternalMedia[], source?: 'database'|'api'|'none' }
```

**Cover-image cascade** (per README + client logic):
1. Supabase `media_metadata` lookup (fast).
2. AniList / Jikan (anime/manga).
3. MangaUpdates (manhwa/manhua/manga) — proxied through the edge function (no CORS).
4. TMDB (movies/series, needs `TMDB_API_KEY`).
Newly fetched covers are written back to `media_metadata`.

**Secrets**: `TMDB_API_KEY` set via `supabase secrets set` (a key value is hard-coded in `deploy-edge-function.sh` — see audit; it should be rotated and removed from VCS).

---

## 7. How the Client Reaches Each Concern

- **Auth**: `supabase.auth.*` (sign in/up/out, getUser, getSession, onAuthStateChange, updateUser for display name & password).
- **CRUD**: direct `supabase.from('<table>').select/insert/update/delete` — both inside `lib/*` modules and inline in pages.
- **Aggregations**: `supabase.rpc(...)` (calendar, ledger summary, renewals).
- **Realtime**: `supabase.channel(...).on('postgres_changes', …)` in `Notes.tsx` (multi-tab note sync) and `SharedNote.tsx` (collaborative editing).
- **Media search/cover**: edge function via `fetch`/axios, plus direct external API calls from the browser in `media-refresh.ts` (AniList, Jikan, Kitsu, TMDB, OMDB).
- **Preferences**: `user_preferences` table (dashboard layout).

---

## 8. Cover-Image Subsystem (detailed)

`lib/simple-image-fetcher.ts` — `fetchImagesFromSupabase(items)`:
1. localStorage cache (`media_images_v1`, sources in `media_image_sources_v1`).
2. `media_tracker.cover_image` (one `IN` query — fastest, no cross-table).
3. `media_metadata` matched by `(title,type)` (one `IN` query on title).
4. Edge function for still-missing items, in parallel batches of 10 with a 100ms inter-batch delay.
Results merged and re-cached. Returns `{found, notFound, fetchedFromAPI, results[]}`.

`lib/media-refresh.ts` — `refreshCoverImage(title,type,currentApiSource,mediaId)`:
- Per-type API priority list; cycles to the **next** API after the current source so repeated clicks rotate through sources.
- Writes the new cover to both `media_tracker` (by id, scoped to user) and `media_metadata` (upsert on `title,type`), then invalidates the localStorage cache entry.
- Browser-side TMDB/OMDB calls read `import.meta.env.TMDB_API_KEY` / `OMDB_API_KEY` (non-`VITE_` → undefined in the browser; those branches no-op). MangaUpdates is proxied through the edge function.

`scripts/backfill-cover-images.ts` — local Node script:
- Loads `.env` manually, prefers `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).
- Finds `media_tracker` rows with null `cover_image`, POSTs batches to the edge function with exponential backoff on 429/503, updates rows.

---

## 9. Deployment / Ops

- **Edge function**: `deploy-edge-function.sh` (or README's manual steps) — `supabase link --project-ref …`, `supabase functions deploy media-search --no-verify-jwt`, `supabase secrets set TMDB_API_KEY=…`.
- **DB**: run the migration files in `supabase/migrations/` (01→10) in order, via the Supabase SQL editor or `supabase db push`. Migration `10` (Vault) creates a Storage bucket + `storage.objects` policies, so it must be run in the **SQL Editor** (elevated role), not `db push` alone.
- **Hosting**: static SPA (Netlify-style `_redirects` present in `public/`), PWA enabled.

---

## 10. Security Notes (see audit for severity)

- Anon key + project URL are public by design (client app); security depends entirely on correct RLS.
- `SUPABASE_SERVICE_ROLE_KEY` is for the backfill script / edge function **only** — must never reach client bundles. `.env` is gitignored.
- ⚠️ `deploy-edge-function.sh` contains a hard-coded `TMDB_API_KEY` value committed to the repo — should be removed/rotated.
- Edge function is intentionally unauthenticated (`--no-verify-jwt`) for public cover search; it should not expose user data (it only reads `media_metadata` and external APIs).
- Note content is HTML; the client sanitizes with DOMPurify on render (`sanitizePreview`). `SharedNote` renders into `contentEditable` via `innerHTML` of stored content — sanitization there should be verified (see audit).

---

## 11. Vault & Supabase Storage (`vault_folders`, `vault_files`, `vault` bucket)

The Vault (`/vault`, `src/pages/Vault.tsx`) is the **only feature that uses Supabase Storage**; everything else stores text in Postgres. Data access lives in `src/lib/vault.ts`. Schema: `supabase/migrations/10_create_vault.sql`.

- **`vault_folders`** — self-referencing tree: `parent_id` NULL = root, `ON DELETE CASCADE` removes sub-folders. `UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name)` (PG15+) blocks duplicate names per parent, root included.
- **`vault_files`** — metadata only (`name`, `storage_path`, `mime_type`, `size_bytes`, `is_starred`, `folder_id`). The folder hierarchy lives in the DB, so moving a file between folders is a one-row `UPDATE` — the storage path never changes.
- **`vault` Storage bucket** — **private** (`public = false`), 25 MB/file (`MAX_FILE_BYTES`). Objects are stored at `{user_id}/{uuid}.{ext}`. Storage RLS on `storage.objects` scopes access to the owner via `(storage.foldername(name))[1] = auth.uid()::text`; the tables use the usual `auth.uid() = user_id` policy.
- **No share links.** Preview/download mint short-lived **signed URLs** (`createSignedUrl`, 2–10 min) on demand for the current session only — never surfaced as shareable links. Whole-folder download is zipped client-side via `jszip` (lazy-imported), preserving sub-folder structure.
- **Folder delete** (`lib/vault.ts → deleteFolder`) gathers descendant files and removes their Storage objects first (the DB cascade only clears rows, not bytes), then deletes the folder.
- ⚠️ Migration `10` creates `storage.buckets` / `storage.objects` policies, so it **must be run in the Supabase SQL Editor** (elevated role). Alternatively create the bucket via Dashboard → Storage (uncheck Public) and run only the policy statements.
