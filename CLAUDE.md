# CLAUDE.md

What an agent must know before changing NoteHaven. Deeper maps: `context/frontend.md` (routes, lib
modules, components, storage keys) and `context/backend.md` (schema, RPCs, RLS, edge function,
migrations). Human setup and deploy: `README.md`. Open items and declined ideas: `docs/BACKLOG.md`.

## Who it's for, and what to optimise

NoteHaven is **Rakshit's personal daily driver**. He is the one real user; one or two trusted people
occasionally use the Vault; production has 7 accounts, nearly all inactive. Usage is **Media** (by far
the most) ≫ **Library** (copying per-project commands) > **Notes** > **Vault**; the rest are secondary.

- **Optimise for** fast loads (first paint, route switches), easy access (few clicks, ⌘K, daily mobile
  use) and responsive feedback (loading states, optimistic updates, toasts, nothing that feels dead).
- **Don't propose enterprise-scale work** (rate limiting, audit trails, multi-tenant admin, heavy
  abstractions). Grade security by real exposure — a handful of trusted accounts — except anything a
  stranger can reach (`/signup`, `/notes/share/:id`, the edge function).

## What it is

A React SPA backed entirely by Supabase (Postgres + RLS, Auth, Storage, Realtime, RPC, one Deno edge
function). There is no custom server; the client talks to Supabase directly.

Pages: Dashboard (widget grid) · Calendar · Tasks · Notes (rich text, autosave, share links) · Library
(Prompts, Code Snippets, Commands tabs) · Media tracker · Work log · Money Ledger · Subscriptions ·
Wishlist · Vault (private files) · Recipes · Birthdays · Bucket List · Tags · Settings. Countdowns have
no page — they live in a dashboard widget and the calendar's quick-add. Route table: `context/frontend.md`.

## Stack

- React 18, TypeScript 5.8, Vite 5 (SWC). Path alias `@/` → `src/`.
- Tailwind 3 + shadcn/ui (Radix; a trimmed set in `components/ui`) + lucide-react + framer-motion.
- react-router-dom 6; TanStack Query 5 (MediaTracker and its `components/media/*`, Library, CommandsTab —
  most other pages use manual `useState` + `useEffect`).
- Tiptap 2 (Notes), CodeMirror 6 (snippets), recharts (ledger charts), cmdk (⌘K), date-fns, DOMPurify,
  jszip (vault downloads).
- supabase-js 2; vite-plugin-pwa (autoUpdate); Vitest 3 (dev).
- **npm only** (`package-lock.json`; no bun/yarn/pnpm). Node 20 in `.nvmrc` and CI; `engines` requires
  Node ≥18 / npm ≥9, enforced by `.npmrc` `engine-strict=true`.

## Commands

```bash
npm install
npm run dev            # http://localhost:8080 (host "::")
npm run typecheck      # tsc --noEmit -p tsconfig.app.json
npm run build          # typecheck, then vite build → dist/
npm run lint           # eslint
npm test               # Vitest: src/**/*.test.ts + supabase/functions/**/*.test.ts
npm run test:insights  # assertion script for lib/media-insights + lib/media-progress
npm run preview        # serve dist/
npm run edge:dev       # the media-search edge function locally in Deno on 127.0.0.1:8787 (PROD database)
npm run link:dry-run   # Media v2 link proposals from a local export; writes nothing (backups/link-dry-run/)
```

Local edge dev: run `edge:dev`, then `VITE_MEDIA_SEARCH_URL=http://127.0.0.1:8787 npm run dev` (process env
only; agents never create or read `.env*` files). The override is **dev-builds only** (`import.meta.env.DEV`
folds it away in production). The local function reads the production database but never writes the shared
caches (`EDGE_CACHE_WRITES=0`; opt in with `EDGE_DEV_CACHE_WRITES=1`). Writes made through the app
(progress, links, History) are real production writes. Behind the office proxy, start it with
`DENO_TLS_CA_STORE=mozilla,system`.

Maintenance scripts (`backfill:*`, `backup:*`, `audit:*`, `smoke:apis`, and the synthetic Tachimanga
fixture generator `npx tsx scripts/make-tachimanga-fixture.ts`) are described in `README.md`.

**Done means** `npm run build`, `npm run lint` (zero errors), `npm test` and `npm run test:insights` all pass —
what CI runs (`.github/workflows/ci.yml`, GitHub Actions, on push to `main` and on PRs), plus an esbuild
parse of the edge function.
- The existing lint warnings are known: `react-hooks/exhaustive-deps` on deliberate mount-only effects
  and `react-refresh/only-export-components`. Don't add new ones, and don't "fix" a mount-only effect by
  adding deps (that's how refetch loops happen).
- Bare `tsc --noEmit` is a **false green**: root `tsconfig.json` has `files: []`. Use `npm run typecheck`.
  `tsconfig.app.json` is loose (`strict: false`).
- Vitest (`vitest.config.ts`, node environment, `@/` alias) covers the pure Media v2 logic
  (`lib/__tests__/`) and the edge function's `adult.ts`. `test:insights` is still a plain `tsx` script.
  Tests import pure modules only; stub the Supabase client, never hit the network.

## Environment

| Where | Variables | Notes |
|---|---|---|
| `.env` — client (copy `.env.example`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public by design; Vite inlines them at build time. `VITE_SUPABASE_PROJECT_ID` is in the template but no code reads it |
| `.env` — local scripts only | `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY` | the service-role key bypasses RLS: **never import it into `src/`**. `OMDB_API_KEY` is still in the template but unused (`backfill:covers` was removed) |
| edge-function secrets (`supabase secrets set`) | `TMDB_API_KEY`, `FANART_API_KEY` (optional), `ALLOWED_ORIGINS` (CORS; unset means `*`), `COVER_COPY_USERS` (user ids allowed to copy covers; unset means nobody) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase runtime |

## Layout

```
src/
  App.tsx                 providers + route table (auth pages eager, everything else React.lazy)
  index.css               Aurora tokens, utilities, animations
  pages/                  one file per route; pages/settings/ holds the Settings sections
  components/             app-level pieces (AppSidebar, PageShell, CommandPalette, Tag*, ConfirmDialog, CodeEditor…)
    ui/                   shadcn primitives + DatePicker, empty-state, filter-pill, motion
    calendar/ dashboard/ ledger/ library/ media/ recipes/ settings/ vault/ work/   feature components
  hooks/, contexts/       auth, preferences, calendar, sidebar, toast…; hooks/media/ (library query, progress)
  lib/                    data access (one module per feature) + pure helpers
  integrations/supabase/  client.ts (the only client) + types.ts
supabase/                 config.toml, functions/media-search/, migrations/
scripts/                  tsx maintenance scripts; __tests__/ holds the insights test; edge-dev/ the local edge server
deploy-edge-function.sh   links the project, deploys media-search, sets its secrets
```

## Database and migrations

- The schema is `supabase/migrations/*.sql`, applied **by hand in the Supabase SQL editor**, in filename
  order: `00_baseline_schema` (the former 01–19, consolidated 2026-08-14), `20_data_cleanup`,
  `21_commands`, `22_security_lint`, `22_wishlist`, `23_work_projects`, `24_share_owner_check`,
  `25_calendar_events_fixes`, `26_tag_usage_triggers`, `27_notes_realtime`, `28_media_source_links`,
  `29_media_v2_import_link` (import map, bulk journal, link proposals, reader-latest and latest
  season/episode columns, Dropped / On Hold), `30_media_covers_bucket` (the public `media-covers` bucket
  with no storage policies, and the `media_cover_copies` log). There is no migration runner; don't use
  `supabase db push` (two files share the `22_` prefix). **Next new file: `31_*.sql`.**
- All of them are live on production (24–27 with fix batch 1; 28 on 2026-09-28; 29 and 30 on 2026-09-29,
  each ahead of the Media v2 code that uses it; prod had no `media_tracker.status` CHECK before 29).
  `30` touches `storage.buckets`, so like `00` it needs the SQL editor's elevated role.
- **Re-run safety:** `21` onwards are all idempotent. **Don't re-run `00` or `20`**: `00` fails with
  "policy already exists" (and, if forced, would re-create `ledger_buckets`), and `20`'s orphan-tag
  cleanup predates `work_project_tags`, so it would delete tags used only by work projects. `24` leaves
  its clean-up DELETE commented out on purpose. `00` builds a fresh project since the 2026-09-28 fix.
- **Migrations only add** (Media v2 rule): no DROP, no bulk rewrite of user rows, and a backup
  (`backup:media` + a Settings → Data export) before any bulk write.
- `src/integrations/supabase/types.ts` is generated, then hand-edited; update it with every schema change.
- Every user table is RLS-scoped to `auth.uid() = user_id`; client queries filter by the signed-in user
  where the existing code does.

## Conventions

- **Data access:** prefer the `lib/*` module for the feature (every newer feature has one). Older pages
  (MediaTracker, Dashboard, Notes, Library, Tasks, Birthdays) also call `supabase.from()` inline — match
  the file you're editing. One Supabase client only (`integrations/supabase/client.ts`).
- **Auth:** wrap protected routes in `<ProtectedRoute>`; get the user from `useAuth()`. For "who am I"
  in data code use `supabase.auth.getSession()`, not `getUser()` (a network round-trip per call).
- **Server state:** the app `QueryClient` (`App.tsx`) defaults to `staleTime` 5 min, `gcTime` 30 min,
  no refetch on focus, `retry: 1`. Keep one strategy per page.
- **Dates:** `dateToYMD` / `parseYMD` from `lib/date-utils.ts`; compare `YYYY-MM-DD` strings. Never
  `new Date('YYYY-MM-DD')` or `toISOString().split('T')[0]` for local dates (UTC drift in IST).
- **Toasts:** `useToast()` from `@/components/ui/use-toast` — the only toast system mounted.
- **Stored HTML:** sanitize with `sanitizeHtml` / `sanitizePreview` (`lib/utils.ts`) before rendering.
- **Styling:** design tokens only (`bg-background`, `text-foreground`, `border-border`, `text-primary`,
  `text-accent-2`, `text-success`, `text-warning`, …); no raw colours when a token exists. Tailwind
  classes must appear literally in source — building `md:${x}` strings produces classes that don't exist.
- **Aurora design system:** charcoal canvas, indigo (`--primary`) → cyan (`--accent-2`) gradient
  accents, glass surfaces with soft glow. Utilities in `index.css`: `.gradient-text[-soft]`,
  `.bg-gradient-brand[-soft]`, `.zen-card` (workhorse card), `.aurora-card` (hero/stat tile), `.glass`
  / `.glass-strong`, `.glow` + `shadow-glow*`, `.chip-tint`, `.loading-shimmer` (skeletons).
  `<Button variant="gradient">` is the one hero CTA per screen; `default` is solid indigo + glow.
- **Themes and preferences:** theme families `aurora` (default), `netflix`, `prime` (`lib/themes.ts`);
  mode is light / dark / system. `applyTheme` rewrites `--primary`, so follow it with
  `applyPreferencesToDOM(getCachedPrefs())` or a custom accent reverts. User preferences go through
  `usePreferences().update()` (stored in localStorage and in `user_preferences`).
- **Page shell:** content pages render through `<PageShell title icon actions subtitle …>` (sidebar,
  gradient header, `lg:hidden` mobile hamburger, entrance transition); Notes, MediaTracker and Calendar
  are bespoke full-height pages. Page roots stay transparent so `<AuroraBackdrop/>` shows through.
  `ui/dialog.tsx` and `ui/sheet.tsx` are already mobile-safe — no per-dialog width hacks.
- **Motion:** the shared helpers in `components/ui/motion.tsx` (`PageTransition`, `Stagger`/`StaggerItem`,
  `FadeIn`). **⌘K** opens `<CommandPalette/>`; programmatically:
  `window.dispatchEvent(new Event('open-command-palette'))`.
- **Adding a route** means touching five hand-kept lists: `App.tsx`, `AppSidebar` `defaultMainNavigation`,
  `settings/SidebarSection` `DEFAULT_ORDER`, `lib/route-prefetch.ts` loaders, and `CommandPalette` items.
- **Tags:** negative tag ids are unsaved placeholders — persist with `createTag`, then the entity's
  `set<Entity>Tags` helper (note, task, media, prompt, snippet, work project).
- **Adding a user table** means adding it to `EXPORT_TABLES` in `lib/full-export.ts`, to `TABLES` in
  `scripts/backup-media.ts` if it's a Media table, and its FK remaps (or an explicit "never restored") in
  `lib/restore.ts`. A table from a migration that may not be pasted yet goes in `NOT_YET_MIGRATED` too.
- **Pure modules** (`media-insights`, `media-progress`, `media-match`, `cover-medium`, `title-match`,
  `tachimanga/plan`, `tachimanga/types`, `components/media/progress-view`, `components/media/import/selection`
  and `sniff`, `components/media/link/match-signals`, `secret-mask`, `recipe-parse`, `pantry-match`)
  must not import the Supabase client — it pulls in `import.meta.env` and breaks the `tsx` test.
- **localStorage** holds UI preferences; guard every access in try/catch. Key list: `context/frontend.md`.
- **Big pages** (MediaTracker, Library, Notes) mix fetching, state and JSX: extract when making
  substantial changes, but keep diffs scoped.

## By design — don't "fix" these

1. **Note sharing goes through RPCs.** `SharedNote.tsx` calls `get_shared_note(p_share_id)` /
   `update_shared_note(...)` (SECURITY DEFINER; the share UUID is the credential, so anon may call
   them). `shared_notes` is owner-only and recipients can't read `notes`. Don't turn it back into a table query.
2. **The edge function verifies JWTs** (`verify_jwt = true` in `supabase/config.toml`; the setting is
   sticky server-side, which is why it lives there) and accepts only a signed-in user's JWT or the
   service-role key (the scripts). Call it
   through `mediaSearchGet` in `lib/edge-function.ts`; a bare `fetch()` gets a 401. TMDB, Wikidata and
   Fanart lookups go through it so their keys stay server-side.
3. **`media_metadata` is a shared, cross-tenant cache** (no `user_id`; upsert on `title,type`). Any
   signed-in user may write it — accepted at this scale (`22_security_lint.sql`). Treat what you read
   from it as untrusted third-party data, and never write personal progress to it.
4. **Subscriptions don't create ledger rows.** Charges are derived at read time
   (`deriveSubscriptionCharges`, `lib/ledger.ts`), and `getLedgerSummary` adds them so Dashboard and
   Money Ledger agree. Money in hand = opening balances + income − expenses − subscription charges
   (`lib/accounts.ts`). `subscriptions.ledger_entry_id` is a legacy, always-null column.
5. **`get_calendar_events` and `get_upcoming_renewals`** are SECURITY DEFINER and raise unless
   `p_user_id = auth.uid()` — always pass the session user's id.
6. **Commands reuse `snippet_folders`** as their projects; there is no separate projects table.
7. **`/work`**: if its tables are missing, the page shows a "tables not set up" panel with Retry
   (`isMissingTableError` in `lib/work.ts` detects PostgREST `PGRST205` / Postgres `42P01`; Wishlist
   does the same). `helped` is a real `TEXT[]` so "people helped" is an `unnest` + `GROUP BY` — don't
   flatten it. Duration is two columns (`duration_value` + `duration_unit`) so it can sort, and `hours`
   is separate from duration (a six-week project can be forty hours). The "People" tab is a disabled
   placeholder.
8. **`/prompts`** is a working alias that renders Library, same as `/library`.
9. **`ledger_buckets` is gone** (dropped by migration 20). Nothing references it; don't bring it back.
10. **Media tags:** the tag filter was removed because `media_tags` never held a row and genres cover the
    same ground. The tag selector on the edit form remains.
11. **The PWA caches Supabase responses** (NetworkFirst, 5 min), so stale reads while offline are expected.
12. **Notes autosave**: 800 ms debounce, flushed on note switch, `visibilitychange` and `beforeunload`;
    a realtime channel on `notes` (filtered by `user_id`) syncs tabs and must be removed on unmount.
13. **Backup and restore** (Settings → Data): the JSON export covers every user table, paged past the
    1000-row cap (`lib/fetch-all.ts`). Restore (`lib/restore.ts`) inserts new rows, remaps FKs and maps
    natural-key clashes onto existing rows; it never updates or deletes. `media_tracker` has no natural key,
    so restoring into a live account **duplicates every title**: the backup is a disaster floor, not an
    undo (bulk Media writes get their Undo from `media_bulk_journal`, migration 29). Vault and
    `user_preferences` are deliberately never restored.
14. **Media v2: user-owned vs source-owned.** `media_tracker` holds what the user owns (`title` is the
    display name, plus type, status, rating, progress, tags, `platform`, `resume_url`, `cover_pinned`);
    linking and refresh never write those. `media_source_meta` holds what the source knows, keyed
    `(source, source_id)`, and **only the edge function writes it** (no client write policies; writes
    revoked). `media_metadata` stays as the legacy shared cache for unlinked entries.
15. **One progress writer; `media_progress_log` is append-only.** Every progress change (taps, the Log
    sheet, Undo, the Tachimanga import) goes through `casProgressWrite` in `lib/media-progress-write.ts`;
    `hooks/media/useProgressMutation.ts` is only its React side (cache patches, toasts). Don't write
    `current_*` columns anywhere else. Compare-and-swap UPDATE first, then a separate log insert. A failed insert never blocks or rolls
    back progress. Undo writes a `kind = 'undo'` row and never deletes one. No UPDATE / DELETE grants.
16. **Covers: one judge, one writer, no automatic search.** `coverVerdict` (`lib/cover-medium.ts`) is the
    only judge (ok / wrong-medium / blocked / unverified), used at write time, in review counts and in
    `audit:covers`, never at display time. `setCover` / `setCovers` (`lib/media-cover.ts`) is the only
    way the app changes a cover: a compare-and-swap on `cover_pinned = false` and the cover he saw,
    writing `cover_origin`, journaled as `kind = 'cover'` in chunks of 5 (a chunk that can't be journaled
    is put back). The only other cover writes are `setCoverPinned` and `linkEntry`'s rule.
    `cover_pinned` = "keep my cover" (pinned + null = "no cover wanted") and beats everything; **a
    Change cover… pick pins** (Undo unpins and restores the old cover). Priority: pin → linked source art
    → reader thumbnail → an existing cover that passes → letter tile. **Web search runs only when he taps
    "Search the web"** in Change cover…; the display never searches (`simple-image-fetcher` reads stored
    covers only, and a linked title shows its stored cover or its source's art, never a by-title guess).
    Don't reintroduce a per-card refresh, a bulk cover refresh or a display-time lookup.
    **Copy first (E2):** every cover the app saves (pick, fix, import, link) goes through `copyCover(s)`
    → edge `action=cover_copy` → the `media-covers` bucket (content-hashed keys), and the stored URL is
    what `setCover` writes (`lib/cover-copy.ts` `urlToSave`: action unreachable → the original, unless
    it's copy-only art like MangaDex's `cover_copy_from`; any other failure → nothing saved). The action
    is **allow-listed** (`COVER_COPY_USERS`; unset = nobody), owner-checked, SSRF-guarded, and capped per
    user, globally and in bytes per day, with every fetch logged in `media_cover_copies` (written only by
    the service role). Never add a storage policy to `media-covers` (a SELECT policy makes it listable),
    and never loosen the guards or caps: sign-up is open to strangers.
17. **Media v2 is live** (shipped 2026-09-29): `action=search|detail|cover_copy`, `adult.ts` and the
    2100 ms AniList pacing are deployed. There is no batch `resolve` action (removed); Link your library
    loops `action=search` at a client pace. Redeploy with `./deploy-edge-function.sh` whenever
    `supabase/functions/media-search/` changes.
18. **Media roadmap is U0–U5, scope frozen** (2026-09-29): one writer per field, cover priority, entry
    points and migration 29 are in `docs/media-v2/PLAN.md` ("Re-cut 2026-09-29"). U6 and the other
    later ideas are parked in `docs/BACKLOG.md`; don't pull them forward. Unit status lives in
    `PLAN.md` § G: U0 → U5 and E2 are shipped; only the phone pass is open.
19. **Tachimanga backups are personal data** (the repo is public). Docs, commits, tests and fixtures
    describe the import feature only: never a title, shelf name, count or other detail from his backup.
    In code: reader titles and shelf (category) names live **only in browser memory** during an import.
    Never log them, toast them, put them in an error message, send them to the edge function, or store
    them. The database gets `media_import_map` (a sha256 `origin_key` + thumbnail URL) and updates to
    his own rows; the shelf → status map stays in `localStorage`. Parsing runs in a Web Worker
    (`lib/tachimanga/parse.worker.ts`; sql.js stays off cold load and out of the PWA precache).
    Fixtures are synthetic `[audit]` data from `lib/tachimanga/__fixtures__/make-fixture.ts`; the
    generator refuses paths inside the repo. **Agents never open `backups/tachimanga/`** (his real
    backups) and never copy a real backup's schema text or entries into the repo.
20. **One full export.** `lib/full-export.ts` `runFullExport` is the only JSON backup (Settings → Data,
    and the backup gate in bulk dialogs). A complete run stamps `sessionStorage` `notehaven.fullExportAt`;
    bulk writes (the import's Approve today) stay disabled until `hasFullExportThisSession()` (60 min).
    Don't add a second exporter or a gate that accepts a partial export.
21. **Every bulk change is journaled.** Anything that writes many `media_tracker` rows at once (the
    import, Link your library approve, every cover change) writes `media_bulk_journal` before/after rows through
    `lib/media-bulk.ts` `writeJournal` **before** it reports done, and must roll back a chunk it can't
    journal. "Undo last bulk change" (`undoBatch`) is a compare-and-swap restore that skips rows changed
    since. Journal rows are never edited except `undone_at` (the grant allows nothing else). Bulk
    Approves share one backup gate (`components/media/import/useBackupGate.ts`).
22. **Source traffic is single-flight.** The Link-your-library resolver (`lib/media-resolve.ts`) and the
    library update pass (`lib/media-update.ts`) share one Web Lock, `SOURCE_TRAFFIC_LOCK`
    (`notehaven-source-traffic`), and each paces 2.5 s start to start, so together they stay inside
    AniList's 30 requests a minute. Anything new that calls the sources in a loop takes the same lock.
    The update pass runs once per Media open (and after a link Approve or a finished run), checks linked
    Watching / Reading titles by id (each at most every 6 h) plus a first look at any title linked since
    its last check, writes bookkeeping columns only, never lowers a stored latest, and stamps
    `latest_changed_at` only when a known latest grows. The resolver writes `media_link_proposals` only,
    and a tab hidden for 15 s hands the run to a visible one. Linking happens on Approve through
    `linkEntry(…, { fromProposal, expect })`: no source call (details come from the update pass), and a
    row that changed is skipped.
23. **Removed in U4 / U5; don't bring them back:** Refresh Library (`RefreshLibraryDialog`),
    `RefreshActivityContext`, Settings → Sync activity, reads of `has_new_content` (the column stays,
    unused) and the "new seasons" filter, `media-refresh.ts` (the cover slot machine), bulk refresh
    covers, `removeCoverImage`, the display-time cover search, `backfill-cover-images.ts` /
    `backfill:covers`, `backfill-media-metadata.ts` / `backfill:metadata`. `release_date` is now written
    by the update pass. The edge function's legacy `q=` / `source=` / batch paths have **no caller left**
    in the repo: dead code in `index.ts`, still deployed; don't build on them.
24. **Linked counts come only from the source.** For a linked title, chapters, episodes, seasons,
    episode lists and status come from `media_source_meta` alone (`linkedMeta` in
    `components/media/source-meta.ts`); legacy `media_metadata` may only fill descriptive blanks. For
    every title, `plausibleMeta` turns a total below his progress into **unknown** (show "Ch 134", never
    "134 of 1", and never clamp logging to it) and drops "upcoming" on something he's started. Don't
    fall back to a legacy count for a linked title.
25. **The installed app updates itself** (`lib/app-update.ts`, started in `main.tsx`; `injectRegister:
    false`). It checks on every route change, on returning to the foreground and every 30 min, and reloads
    when a new version takes over, unless a hold is set. Anything that must not be cut off by a reload
    (unsaved edits, a bulk write in progress) calls `holdReload(key, true)` and clears it when done;
    today that's the Media edit form, the import and link Approves and the Wrong-covers fix.

## Decided — don't re-litigate

- **2026-08-20 backlog triage:** every proposal was declined except Vitest smoke tests for `lib/*` (the
  runner landed with Media v2). The
  declined list is in `docs/BACKLOG.md` — don't re-propose those items.
- **2026-08-20 TMDB key:** `381f2d0e…`, committed in `aea34a8`, stays readable in git history. The owner
  chose not to rotate it (worst case: someone burns free-tier TMDB quota). `deploy-edge-function.sh`
  reads `TMDB_API_KEY` from the environment, and `ALLOWED_ORIGINS` is set on the deployed function.
- **2026-08 security hardening** (share-link policies, unchecked `p_user_id` in the definer RPCs) was
  confirmed closed on production on 2026-08-14. `docs/audit/AUDIT_ONE_SHOT.sql` re-checks the live
  database as one statement (the SQL editor shows only the last result set). Its section 13 now checks
  the `ledger_buckets` retirement through the catalog, so the statement runs again.

## Docs

- `README.md` — setup, run, deploy, maintenance scripts, troubleshooting.
- `context/frontend.md` — routes → pages → lib → tables, components, hooks, theming, storage keys, build.
- `context/backend.md` — tables, RPCs, triggers, Storage, realtime, edge function, migrations, scripts.
- `docs/BACKLOG.md` — open items, known limitations, declined ideas.
- `docs/media-v2/` — `PLAN.md` (design and phases), `PHASE1-BRIEF.md`, `HANDOFF.md` (live state).
