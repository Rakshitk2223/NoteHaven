# NoteHaven — frontend map

How the React app is put together: providers, routes, what each page talks to, the `lib/*` data layer,
components, theming and preferences, storage keys, and the build. Conventions and gotchas are in
`CLAUDE.md`; the database side is in `context/backend.md`.

## Providers (`src/App.tsx`, outer → inner)

```
QueryClientProvider        staleTime 5 min · gcTime 30 min · no refetch on focus · retry 1
 └ AuthProvider            hooks/useAuth.tsx
    └ PreferencesProvider  hooks/usePreferences.tsx (lib/preferences.ts)
       └ SidebarProvider   contexts/SidebarContext.tsx
          └ TooltipProvider (delay 200 ms)
             └ AppShell
                └ MotionConfig (reducedMotion from prefs)
                   ├ Toaster                 shadcn toast (the only toast system)
                   ├ AuroraBackdrop          only while prefs.backgroundEffects is on
                   └ BrowserRouter
                      ├ CommandPalette       ⌘K, mounted on every route
                      └ AppInner → <div key={pathname} class="animate-route"> → Suspense(RouteFallback) → Routes
```

- `AppShell` exists so it can read preferences (motion, backdrop) from inside `PreferencesProvider`.
- `AppInner` applies the theme on mount — resolve mode (`getStoredMode` → `resolveMode`), toggle `.dark`,
  `applyTheme(getCurrentTheme(), mode)`, then `applyPreferencesToDOM(getCachedPrefs())` — and follows the
  OS colour scheme while mode is `system`. Keying the wrapper on the pathname remounts and fades every route.
- `Index`, `Login`, `SignUp`, `CheckEmail`, `ResetPassword` and `NotFound` load eagerly; every other page
  (including the public `SharedNote`) is `React.lazy`.
- There is no app-wide media sweep any more (`RefreshActivityContext` and Refresh Library were removed
  in U4). Media's background work (the library update pass and "Link your library") lives in
  lazy-loaded singletons that coordinate through a Web Lock, not a provider.

## Routes

Shell: **PS** = renders through `PageShell`; **B** = bespoke full-height layout (own `AppSidebar` +
`lg:hidden` hamburger); **—** = standalone screen. Every page marked 🔒 is wrapped in `<ProtectedRoute>`,
which shows a pulse card while auth loads, then redirects to `/login` when there's no user.

| Path | Page | | Shell | `lib/*` (page + its components) | Supabase (direct + via lib) |
|---|---|---|---|---|---|
| `/` | `Index` | | — | — | none; redirects to `/login` |
| `/login` | `Login` | | — | preferences | `signInWithPassword`; a signed-in user goes to `prefs.defaultLanding` |
| `/signup` | `SignUp` | | — | — | `auth.signUp` |
| `/check-email` | `CheckEmail` | | — | — | `auth.getUser` |
| `/reset-password` | `ResetPassword` | | — | — | `resetPasswordForEmail`, then `updateUser({password})` on `PASSWORD_RECOVERY` |
| `/notes/share/:shareId` | `SharedNote` | | — | utils | RPCs `get_shared_note`, `update_shared_note` only |
| `/dashboard` | `Dashboard` | 🔒 | PS | dashboard, tags, subscriptions, ledger | inline `tasks`, `notes`, `media_tracker`, `prompts`, `countdowns`, `birthdays`; `user_preferences`; RPCs `get_upcoming_renewals`, `get_monthly_ledger_summary` |
| `/library` (alias `/prompts`) | `Library` | 🔒 | PS | tags, codeSnippets, commands | `prompts`, `prompt_tags` inline; `code_snippets`, `snippet_folders`, `commands`, tag junctions |
| `/media` | `MediaTracker` | 🔒 | B | edge-function, media-sources, media-link, media-match, media-progress, media-progress-write, media-bulk, media-resolve, media-update, media-cover, full-export, tachimanga/*, media-metadata, simple-image-fetcher, media-insights, cover-medium, tags (+ `hooks/media/*`) | `media_tracker` (inline + hooks), `media_metadata` (read), `media_tags`, `media_source_meta` (read), `media_progress_log`, `media_import_map`, `media_bulk_journal`, `media_link_proposals`; edge function (`action=search|detail` only) |
| `/tasks` | `Tasks` | 🔒 | PS | tags, date-utils | `tasks`, `task_tags` inline |
| `/notes` | `Notes` | 🔒 | B | tags | `notes`, `note_tags`, `shared_notes` inline; realtime on `notes` |
| `/calendar` | `Calendar` | 🔒 | B | calendar, date-utils (`hooks/useCalendar`) | RPC `get_calendar_events`; quick-add inserts `tasks` / `birthdays` / `countdowns` |
| `/work` | `Work` | 🔒 | PS | work, tags | `work_projects`, `work_project_tags` |
| `/ledger` | `MoneyLedger` | 🔒 | PS | ledger, accounts, category-init, subscriptions | `ledger_entries`, `ledger_accounts`, `ledger_categories`, `subscriptions` |
| `/subscriptions` | `Subscriptions` | 🔒 | PS | subscriptions, category-init, ledger | `subscriptions`, `subscription_categories` |
| `/wishlist` | `Wishlist` | 🔒 | PS | wishlist | `wishlist_items` |
| `/vault` | `Vault` | 🔒 | PS | vault | `vault_folders`, `vault_files`; Storage bucket `vault` |
| `/recipes` | `Recipes` | 🔒 | PS | recipes, recipe-parse, pantry-match | `recipes`, `recipe_folders`; TheMealDB; Openverse |
| `/birthdays` | `Birthdays` | 🔒 | PS | date-utils | `birthdays` inline |
| `/bucket-list` | `BucketList` | 🔒 | PS | bucket-list | `bucket_list`; Openverse |
| `/tags` | `TagsIndex` | 🔒 | PS | tags | `tags` |
| `/tags/:tagName` | `TagView` | 🔒 | PS | tags | `tags` + `searchByTag` across all six junctions |
| `/settings` | `Settings` | 🔒 | PS | preferences, themes, dashboard, image-cache, media-metadata | `auth.updateUser`, Storage bucket `avatars`, every user table (backup), `user_preferences` |
| `*` | `NotFound` | | — | — | links to `/dashboard` when signed in, otherwise `/login` |

**Deep links:** `/notes?new=1`, `/tasks?new=1`, `/tasks?task=ID`, `/media?new=1` (opens Browse),
`/media?media=ID` (opens that title's detail, fetched by id if not loaded), `/work?new=1`,
`/library?tab=prompts|snippets|commands`, `/library?prompt=ID`, `/library?snippet=ID`,
`/settings?section=<id>`. The command palette uses the `?new=1` and `?tab=` forms.

**Navigation lists are kept by hand in four places** — `AppSidebar` `defaultMainNavigation` (14 items;
`/tags` is palette-only), `settings/SidebarSection` `DEFAULT_ORDER`, `lib/route-prefetch.ts` loaders, and
`CommandPalette` items. A new route needs all four plus `App.tsx`. Saved sidebar orders get new default
items appended automatically.

## Pages — what's worth knowing

- **Dashboard:** a responsive 1 / 2 / 4-column grid of 13 widget types (`today`, `stats`, `tasks`,
  `notes`, `media`, `prompts`, `pinned`, `tags`, `countdowns`, `birthdays`, `subscriptions`,
  `calendar-mini`, `ledger`). The layout (type, visible, position, size quarter/half/three-quarters/full)
  lives in `user_preferences` key `dashboard_widgets` via `lib/dashboard.ts`; the loader drops unknown
  types and appends new defaults. Data is one `Promise.allSettled` wave, so a failing table empties only
  its own widget. Calendar-mini events are synthesized client-side. `WidgetManager` shows/hides, drag
  reorders and resizes widgets, and toggles "fill space" (masonry via `MasonryItem`, per device in
  `localStorage.dashboard_fill_space`). The saved layout loads before first paint, so `DEFAULT_WIDGETS`
  never flashes.
- **Notes:** a master/detail layout (single pane with a toggle on mobile) with a Tiptap editor. Autosave
  debounces title and content separately (800 ms) and flushes on note switch, `visibilitychange` and
  `beforeunload`. A realtime channel (`notes-changes`, filtered by `user_id`) syncs other tabs; echoes of
  your own saves are skipped by comparing the server `updated_at` (`lastSavedUpdatedAtRef`). An "Inbox"
  note is auto-created and pinned to the top. `background_color` holds a sticky-note category key.
  Sharing creates or reuses a `shared_notes` row (`/notes/share/:id`, optional `allow_edit`). The list
  paginates client-side, 50 per page.
- **SharedNote:** loads through `get_shared_note`, saves through `update_shared_note` (800 ms debounce)
  into a `contentEditable`; HTML is sanitized on load and on save. No realtime.
- **Tasks:** add form (text + `DatePicker` + tags), To-Do and Completed sections with pinned first;
  overdue is red and due-today amber, with relative labels. Complete and pin write to the database first,
  then update state. AND tag filtering; tags appear on hover on pointer devices and always on touch.
- **Library:** three tabs (tab persisted in `library-active-tab`), all on React Query.
  *Prompts:* cards, a category filter, a tag filter, copy with a `{{variable}}` fill-in dialog, optimistic
  favourite/pin with rollback, and "Move to Commands" (which deletes the prompt).
  *Snippets:* grouped by project folder (`snippet_folders`) plus "Unfiled", a CodeMirror viewer/editor,
  and secret masking for any language (`lib/secret-mask.ts`).
  *Commands* (`components/library/CommandsTab.tsx`): grouped by project folder, then by free-text
  category; reordered within a category via `reorderCommands`.
- **MediaTracker** (Media v2 on the `media-v2` branch: a Mihon-style library; design in
  `docs/media-v2/PLAN.md`). Bespoke page, still ~3,200 lines, with pieces extracted into
  `components/media/*` and `hooks/media/*`.
  - **Sections** (`MediaSectionNav`): Library · Updates · History · Browse · More. Updates needs
    migration 29 and History needs 28 (`detectMediaV2Schema` in `lib/media-link.ts`: `limit(0)` probes
    for `sourceLinks`, `progressLog` and, strictly, `importLink` (29); a missing table hides the feature
    rather than showing it empty). Section
    and per-section scroll are in-memory state (every visit starts on Library); Library stays mounted and
    hidden, while the other sections mount on open. Bottom bar (fixed, safe-area padded) below 768 px and
    in portrait; top tabs at ≥1280 px or ≥768 px landscape. The page headers switch at Tailwind `lg`
    (1024 px); the PageShell-style hamburger stays on mobile.
  - **Metadata:** one `metaFor` per title (`buildMetaIndex` in `components/media/source-meta.ts`): a
    linked title reads `media_source_meta` (the slim `SOURCE_META_SLIM` columns for grid, rails, filters
    and sorts; the full row in the detail view) and legacy `media_metadata` only fills blanks; an
    unlinked title reads the legacy cache as it is. Nothing searches for a missing cover at display time:
    `simple-image-fetcher` reads stored covers and caches only.
  - **Library:** `LibraryGrid` (cover tiles; the log number or the Movies `WatchedToggle` under each
    cover; the "N behind" badge from `latestOf` = the higher of the source's and the reader's latest,
    never on Completed / On Hold / Dropped; long-press 450 ms to select) or the list
    view (`MediaListRow`, 44 px controls, ⋮ `MediaActionsMenu`). Grid size S / M / L (`grid-size.ts`,
    default M; 3 columns on phone up to 8 at `xl`; narrower set while the Mac pane is open). Type pills
    and custom groups (`CustomGroupBuilder`), status, sort, debounced search, genre chips (`GenreRail`,
    AND), a "More filters" sheet (all / behind, needs cover; Behind uses the badge's rule; the old
    "new seasons" option and its dot are gone), removable filter chips. `LinkBar` sits above the grid:
    the "Linking · done/total" pill during a run and the **"Needs a pick · N"** chip. Rails
    (`ContinueShelf`, `AiringSoon`) show when `mediaShowRails` is on and no filter is active. The grid is
    flat (no Active / Planned / Completed grouping).
  - **Detail** (`MediaDetailPanel` framing `MediaDetailView` / `MediaEditForm`): phone = full-screen
    right Sheet (`h-dvh`, safe-area padded); iPad (768–1279) = right Sheet, `sm:max-w-xl` (576 px); Mac
    (≥1280) = a sticky 420 px `<aside>` beside the grid with ‹ › buttons, ← / → stepping through the
    visible items (prefetching the next page) and Esc to close. Keys are ignored in inputs, with
    modifiers, or while another dialog is open; no stepping in edit mode. The panel draws its own X and
    has no footer Close. View mode shows Edit + ⋮ (Edit, Fix match / Link source, Pin / Unpin cover,
    **Change cover…**, Remove cover, Delete); linked titles show the source's score and chapters out, and source metadata (`['sourceMeta']`,
    `media_source_meta` first, else a `detail` fetch) and an "Open on <platform> ↗" resume link when set.
    Any open / close / step with unsaved edits goes through `guardEdits` → "Discard changes?". Edit →
    Update stays on the title and toasts "Saved" with Undo. The Edit form (and PickPreview on add) has
    **Platform** (free text + suggestions) and **Resume link** (must be `http(s)://`), shown once
    migration 28 is detected.
  - **Logging** (`ProgressControl`, `LogNumberButton` → `LogSheet` / `LogPanel`): a bottom sheet
    everywhere except `(min-width:1280px) and (pointer:fine)`, where it's a popover; number input,
    +1 / +5 / +10 / +50 chips, "Caught up (N)" when a latest is known, one write, Undo toast.
    **One progress writer:** `lib/media-progress-write.ts` `casProgressWrite`, shared by
    `useProgressMutation` (taps, Log sheet, Undo) and the Tachimanga import. The hook cancels in-flight
    list / rail reads and patches every cached copy; the writer does the compare-and-swap
    `UPDATE media_tracker … WHERE <col> = base` (3 attempts; ±N re-plans on a miss, an explicit set or
    Undo raises "Changed on another device"), then a best-effort `media_progress_log` insert. Undo is a
    reverse CAS that appends `kind = 'undo'` rows. Status /
    rating patches, the Watched toggle, the Edit form (writes progress only when it changed), bulk
    actions and the starting progress on add are plain updates and aren't logged.
  - **Browse** (`SourcePicker` → `PickPreview`): search-and-pick across the type-correct sources
    (`lib/media-sources.ts` → edge `action=search`), 350 ms debounce with abort, grouped by source (a
    column per source at ≥1280, horizontal rows below), per-source status, "different type" dimming,
    "Linked" / "In library" markers (from `['mediaTitleIndex']`, the whole library, matched by source id
    or normalised title + type). A pick of a loaded in-library title opens
    it; otherwise PickPreview sets status + starting progress, inserts `media_tracker`, then
    `linkEntry(…, { isNew: true })`; Undo deletes the new row. **"Add without linking"** is always
    offered once there's a query. This replaces the old Quick Add dialog; the header Add button, the
    empty state and `?new=1` all open Browse.
  - **Fix match / Link source** (only with migration 28): the same picker in a Dialog with the type
    locked and the title prefilled; PickPreview can offer "Use this entry's cover" when the title isn't
    pinned.
  - **Covers** (U5; one pipeline, `lib/media-cover.ts`). **Change cover…** (`ChangeCover`, ⋮ menu, hidden
    while pinned) lists options in priority order: the linked source's art → the reader app's thumbnail →
    the current cover → **web search, only when he taps "Search the web"**. Each option carries its
    `coverVerdict` (ok / unverified / wrong kind / won't load); wrong-kind and won't-load options can't
    be picked. Picking one writes it through `setCover` with that option's origin; it does **not** pin
    (pinning is a separate ⋮ action).
    **Wrong covers · N** (`WrongCovers`, from More) lists covers that are wrong-medium, blocked or missing,
    with a one-tap fix to the default (source art for linked titles, the reader thumbnail otherwise).
    **Pin / Unpin** and **Remove cover** (a pinned null cover) stay in the ⋮ menu. Every change goes
    through `setCover(s)` and is journaled, so "Undo last bulk change" covers it. The old per-card
    Refresh cover (the slot machine) and bulk refresh covers are gone.
  - **Updates** (`UpdatesView`, U4): titles whose latest chapter or aired episode **grew**, newest
    first, grouped by day, over the last 30 days ("Ch N out", "S2 · E5 aired"); tap opens the title;
    **Check now** forces a pass. The data comes from the **library update pass** (`lib/media-update.ts`):
    once per Media open, paced 2.5 s start to start, it checks linked Watching / Reading titles (each at
    most every 6 h) **by id** through `action=detail`. Reading types update `last_known_latest_chapter`;
    watch types update the latest **aired** season + episode (TMDB / TVmaze; AniList-linked anime have no
    episode latest) and move the next air date into `release_date` for the Calendar. A stored latest is
    never lowered, and `latest_changed_at` is stamped only when a *known* latest grows (the first sighting
    is a baseline). It writes bookkeeping columns only, each guarded on what it read.
  - **Link your library** (U3; More → Link your library, needs 29): `lib/media-resolve.ts` walks every
    **unlinked** title, one at a time, ≥ 2.5 s start to start (60 s back-off on a rate limit; it waits
    while the tab is hidden or offline), searches the type-correct sources and stores a proposal in
    `media_link_proposals` (bands auto / review / none / error; error rows are retried). It never writes
    `media_tracker`. The run is resumable from any device (the server is the cursor; the run / pause
    intent is kept per device). **Auto-matched · N** (`AutoMatched`) lists the confident links, all
    included by default, each with "keep my cover". **Needs a pick** (`LinkQueue`, one `ReviewCard` per
    title, the same card the import uses) shows up to three candidates; a work already linked to another of
    his titles can't be picked, and duplicates are flagged. Approve (`useLinkApprove` →
    `link/apply-links.ts`) is behind the shared backup gate, links each title with `linkEntry(…, { expect,
    keepCover })` (skipped if the row changed since the proposal), journals chunks of 5 as `kind = 'link'`,
    and toasts Undo. Linking writes link fields, the latest mirror and (by its rules) the cover, never
    progress, status, rating or title.
  - **One lock for source traffic:** the resolver and the update pass share the Web Lock
    `notehaven-source-traffic` (`SOURCE_TRAFFIC_LOCK`), so across tabs and devices on one browser only one
    of them talks to the sources at a time and together they stay inside AniList's 30 requests a minute.
  - **History** (`HistoryView`): `media_progress_log` with the embedded tracker row, newest first, 50 per
    page, grouped by day, undo rows marked ↺ and import rows labelled "via Tachimanga"
    (`history-labels.ts`); tapping opens the title.
  - **More** (`MediaMoreView`): grid size, rails toggle, type tabs, select titles (bulk status and
    delete), Library stats (`LibraryStatsDialog`, paged over the **whole** library, metadata in chunks),
    **Link your library**, **Wrong covers · N** (when there are any), **Import…** (with migration 29;
    "Import JSON…" before it), export JSON / CSV / TXT, and **Undo last bulk change**
    (`['mediaBulkLatest']` → `lib/media-bulk.ts` `undoBatch`) while an undoable batch exists. There is
    no Refresh library… row any more.
  - **Import…** sniffs the file's first bytes, never its name (`import/sniff.ts`; `.json`, `.tmb` and
    `.zip` accepted, since test backups travel renamed as `.zip` so iOS doesn't offer to open them in the
    reader app). JSON goes to the legacy JSON import; a zip opens `ReaderImportDialog` (lazy; full
    screen on phone):
    1. **Parse** in a Web Worker (`lib/tachimanga/parse.ts` → `parse.worker.ts`, sql.js + jszip, kept
       out of cold load and the PWA precache; the worker is terminated after one parse to free the wasm
       heap). Files over 300 MB are refused. Stages: unpacking → opening → reading → hashing.
    2. **Categories:** map each reader shelf to a status or "don't change" (default). Kept in
       `localStorage` only.
    3. **Plan** (`lib/tachimanga/plan.ts`, pure): matches by import map → title (≥ 0.95 with no near tie;
       0.8–0.95 → "Needs a match") → a linked row's source alt titles; reading types only.
    4. **Preview** (`ImportPreview`): Moves forward (ticked) · Status changes · NoteHaven is ahead
       (untouched unless "Set back" is ticked) · Needs a match (pick or skip) · Not in NoteHaven (tick to
       add; each needs a type) · Covers (ticked only where his is missing or the wrong kind; never over a
       pinned or linked cover). NSFW entries are hidden unless shown, and never matched or applied. The
       preview also counts how many reader thumbnails load (the measure-first number for E2).
    5. **Approve** is disabled until a **complete** full export has run in this session within 60 min
       (`import/useBackupGate.ts` + `BackupNote`, shared with Link your library; "Back up now" runs
       `lib/full-export.ts` inline). `import/apply.ts` then writes only the
       ticked rows, in chunks, every part guarded against the preview's snapshot, and journals each
       chunk; if the journal write fails, that chunk is rolled back and the import stops. The toast
       offers Undo. Re-importing the same file plans zero writes.
    **Privacy:** reader titles and shelf names stay in memory in the browser. They're never logged,
    toasted, sent to the edge function or stored; the database gets hash keys, thumbnail URLs and his
    own row updates only.
  - Types: Movie, Series, Anime, Manga, Manhwa, Manhua, KDrama, JDrama; statuses: Watching, Reading,
    Plan to Watch, Plan to Read, Completed, **On Hold, Dropped** (29; shelved titles drop out of the
    rails and never get a behind badge). The tag *filter* is gone (genres replaced it); the edit form
    still has a tag selector.
- **Calendar:** Month, Week and Agenda (rolling 30 days, phone-first) views over `get_calendar_events`,
  filtered client-side (filters in `localStorage.calendar_filters`). `DayDetailModal` → `DayDetail` deep
  links to the source rows; `QuickAddDialog` creates tasks, birthdays or countdowns.
- **MoneyLedger:** accounts (bank / cash / card, with opening balances) and a cumulative "money in hand";
  transfers between accounts; per-account balance tiles; `AccountsManager`, `LedgerCharts` (recharts),
  `LedgerEntryForm` (Enter to save). Month, year and last-used account are remembered. Subscription
  charges are derived, not stored (`deriveSubscriptionCharges`). Categories are seeded once per account
  (`ensureLedgerCategoriesExist`). CSV/JSON export. Currency and locale come from preferences (default
  INR / en-IN).
- **Subscriptions:** Monthly Cost / Yearly Cost / Active / Renews Soon cards, then a list with status and
  renewal countdown. Categories are seeded on first use; deletes are confirmed.
- **Wishlist:** items with a current price and a "buy at" target; every price check is appended to
  `price_history`; items at or under target show as deals (toasted once, then `markDealsNotified`).
- **Vault:** a nested folder tree with files in the private `vault` bucket. Uploads resolve name clashes
  with `DuplicateResolveDialog` (replace / keep both / skip); previews and downloads use short-lived
  signed URLs (`FilePreviewModal`); folders and multi-selections download as zips (jszip, lazily
  imported); `MoveToFolderDialog` excludes the folder's own subtree. No share links.
- **Recipes:** folders, favourites, a cook mode, TheMealDB search and import, Openverse image
  suggestions, dictate-or-paste parsing (`DictateParse` → `lib/recipe-parse.ts`), and a pantry matcher
  (`PantryPanel` → `lib/pantry-match.ts`; the pantry lives in `localStorage.recipesPantry`, not in a table).
- **Work:** a projects log (card or table view) with people helped (`PeopleInput` → `helped TEXT[]`),
  month, duration, hours, team, link and status; summary tiles. The "People" tab is a disabled placeholder.
- **Birthdays:** hero "next birthday", This month, and All (soonest first); cards show turning-age,
  days-until and zodiac. One shared add/edit dialog with cascading year → month → day selects.
- **Bucket List:** items with a category and a status (dreaming / planned / achieved), a target date and
  Openverse image suggestions.
- **Tags:** `/tags` lists every tag; `/tags/:name` shows notes, tasks, media, prompts, snippets and work
  projects carrying it. Tag badges link there.
- **Settings:** a searchable rail (`?section=`, default `account`) over eleven section files in
  `src/pages/settings/`, built from `components/settings/primitives.tsx`:

  | Section | Does |
  |---|---|
  | Account | avatar (public `avatars` bucket), display name, email change, per-feature item counts |
  | Appearance | theme family, mode light / dark / system, accent colour, text size, corner radius, reduce motion, background effects |
  | Accessibility | high contrast, underlined links, always-visible focus rings, readable font, reduce motion |
  | Behavior | start page after login, Media default view and sort, Vault default view, Library default tab |
  | Language & region | currency and locale (drive `formatCurrency`) |
  | Dashboard | the WidgetManager, embedded |
  | Sidebar | collapse, drag-reorder the nav |
  | Keyboard | shortcut list; opens the palette |
  | Security | change password (re-authenticates with the current one first) |
  | Data | the one full JSON export (`lib/full-export.ts`: every table in `EXPORT_TABLES` + tag junctions, paged past PostgREST's 1000-row cap; migration 29 tables skipped if absent); restore through `lib/restore.ts` (new rows, FKs remapped, History and the import map remapped by `media_id`; Vault, preferences, link proposals and the journal skipped); Vault usage; clear the cover cache |
  | About | version, environment, external link |

## `src/lib/*`

| Module | Responsibility | Talks to |
|---|---|---|
| `accounts.ts` | ledger accounts; money-in-hand maths (`computeMoneyInHand`, `computeAccountBalances`) | `ledger_accounts` |
| `bucket-list.ts` | bucket-list CRUD, categories and status metadata, image suggestions | `bucket_list`; Openverse |
| `calendar.ts` | event colour / label / icon maps, grouping by date | — |
| `category-init.ts` | seed default ledger and subscription categories once per account | `ledger_categories`, `subscription_categories`, `user_preferences` (seed flag) |
| `codeSnippets.ts` | snippets and project folders, supported languages, tag wiring; re-exports the secret masking | `code_snippets`, `code_snippet_tags`, `snippet_folders` |
| `commands.ts` | Commands tab CRUD and reorder (projects = `snippet_folders`) | `commands` |
| `dashboard.ts` | widget types, metadata, default layout, load / save / reset | `user_preferences` (`dashboard_widgets`) |
| `date-utils.ts` | local `YYYY-MM-DD` helpers: `dateToYMD`, `parseYMD`, `formatDateForDisplay`, `formatDateDDMMYYYY`, `isToday`, `addDays` | — |
| `cover-medium.ts` | pure: **the one cover judge**, `coverVerdict(url, type, origin)` → ok / wrong-medium / blocked / unverified (provenance — source, manual, reader — only vouches for an unknown host, never for a wrong medium); plus `coverMedium`, `coverFitsType`, `isUsableCover`, `isHotlinkBlocked`. Runs at write time, in review counts and in `audit:covers`, never at display time | — |
| `edge-function.ts` | `mediaSearchGet` / `mediaSearchUrl`: authenticated GET to `media-search`; `null` on no session, non-2xx or network error. Dev builds honour `VITE_MEDIA_SEARCH_URL` (the local `edge:dev` server); production folds it away | edge function |
| `full-export.ts` | **the one full export**: `EXPORT_TABLES` / `EXPORT_JUNCTIONS`, `runFullExport` (downloads the file; tables not set up yet are skipped, unreadable ones fail it), and a per-tab "complete export this session" flag (`hasFullExportThisSession`, 60 min) that bulk dialogs gate on | every user table |
| `fetch-all.ts` | `fetchAllRows`: page any query past PostgREST's 1000-row cap (needs a fresh, fully ordered query per page) | — |
| `image-cache.ts` | localStorage cover cache with a 24 h TTL, merge-on-write | — |
| `ledger.ts` | entries CRUD, monthly summary (RPC + derived subscription charges), CSV/JSON export, `formatCurrency` | `ledger_entries`, `subscriptions`; RPC `get_monthly_ledger_summary` |
| `logger.ts` | `devLog` (dev-only logging) | — |
| `media-cover.ts` | **the one cover writer**: `setCover` / `setCovers` (compare-and-swap on `cover_pinned = false` and the cover he saw, writes `cover_image` + `cover_origin`, journaled as `kind = 'cover'`, optionally into an existing batch so an import has one Undo; rows are put back if the journal fails), `coverCandidates` ("Change cover…" options; web search only on request), `defaultCover`, `wrongCovers` / `loadWrongCovers` / `fixWrongCovers`. Lazy | `media_tracker`, `media_bulk_journal`, `media_source_meta` / `media_import_map` (read); edge function |
| `media-insights.ts` | pure derivations: continue queue, airing soon, genres, library stats, duplicates (unit-tested) | — |
| `media-bulk.ts` | the bulk-change journal: `writeJournal`, `latestUndoableBatch`, `undoBatch` / `restoreEntries` (compare-and-swap restore; `op = 'insert'` rows are deleted; changed rows skipped and counted), `hasGuard`, `UNGUARDED_COLUMNS` | `media_bulk_journal`, `media_tracker`, `media_progress_log` (undo rows) |
| `media-link.ts` | Media v2 binding: `linkEntry` (link fields + latest-chapter mirror + cover rules judged by `coverVerdict`; never a pinned cover; `keepCover` leaves it alone; `expect` = guarded bulk mode that writes only while title, type, link state and cover still match, else `changed`), `unlinkEntry`, `setCoverPinned`, `refreshLinked` (by id; never lowers a stored latest; never the cover or a user field), `readSourceMeta[Batch]` + `SOURCE_META_SLIM`, `detectMediaV2Schema`. Every write returns an `undo()`; a missing migration returns `needs-migration` | `media_tracker` link columns, `media_source_meta` (read), `media_progress_log` (probe); edge function |
| `media-match.ts` | pure match scoring: title vs all alt titles, type / country gate, year, plausibility; `AUTO_LINK_MIN` 0.9, `REVIEW_MIN` 0.6; near-tie (≤0.05) demotes auto → review only against a *different* work (the same work on two sources isn't a rival). Used by `media-sources`, the dry-run script and tests | — |
| `media-metadata.ts` | reads the legacy `media_metadata` cache for unlinked titles (`fetchMediaMetadataBatch`) and re-exports the pure progress helpers. The Refresh Library sweep and the new-content flag are gone | `media_metadata` |
| `media-update.ts` | the library update pass: `createUpdater` / `getUpdater` (paced, single-flight on the same lock), pure `dueForUpdate`, `latestAired`, `nextReleaseDate`, `planUpdate`, `groupUpdates`; `fetchUpdates` feeds the Updates tab. Lazy | `media_tracker` (latest + `release_date` bookkeeping, guarded); edge `action=detail` |
| `media-progress-write.ts` | **the one progress writer**: `casProgressWrite` (compare-and-swap, re-plan or `ProgressConflictError` on a lost race), `appendProgressLog`, `posOf`; no React, no query cache | `media_tracker`, `media_progress_log` |
| `media-progress.ts` | pure progress types, `computeProgress`, and `nextProgress` (chapter clamp to latest / total; episode season rollover both ways; season floor 1) | — |
| `media-resolve.ts` | the "Link your library" resolver: `createResolver` / `getResolver` (paced, resumable, single-flight via `SOURCE_TRAFFIC_LOCK`), and pure `classify`, `pendingRows`, `orderQueue`, `tally`, `findDuplicates`. Writes proposals only. Lazy | `media_tracker` (read), `media_link_proposals`; edge `action=search` |
| `media-sources.ts` | typed v2 edge wrappers: `searchSources`, `fetchSourceDetail`, `sourcesForType`, `SOURCE_LABEL`; a missing edge action degrades to per-source `unavailable` | edge function (`action=search|detail`) |
| `pantry-match.ts` | "cook with what I have" scoring (pure) | — |
| `preferences.ts` | the `AppPreferences` blob, light/dark/system mode, `applyPreferencesToDOM` | localStorage + `user_preferences` (`app_preferences`) |
| `recipe-parse.ts` | free-text → recipe parser (pure) | — |
| `recipes.ts` | recipes and folders, TheMealDB search / import, image suggestions | `recipes`, `recipe_folders`; TheMealDB; Openverse |
| `restore.ts` | JSON-backup restore: inserts new rows parents-first, remaps every FK and tag link through old → new ids, maps natural-key clashes onto existing rows; never updates or deletes; skips Vault and `user_preferences` | every restorable user table |
| `route-prefetch.ts` | `prefetchRoute`: warm a lazy route chunk on nav hover / focus | — |
| `secret-mask.ts` | pure secret masking for the snippet viewer | — |
| `simple-image-fetcher.ts` | batched cover lookup for display: cache → `media_tracker.cover_image` → `media_metadata` (chunked `IN`). **Never searches**: a missing cover stays missing until he picks one | `media_tracker`, `media_metadata` |
| `subscriptions.ts` | subscriptions and categories, renewal maths, summary, status labels; `getUpcomingRenewals` (Dashboard) | `subscriptions`, `subscription_categories`; RPC `get_upcoming_renewals` |
| `tachimanga/*` | the reader-backup import: `types.ts` (contract, types only), `parse.ts` (main thread: size check, Worker), `parse.worker.ts` + `parse-core.ts` (sql.js over the backup's one `.db`; tables and columns discovered, not assumed; read-only), `plan.ts` (**pure** planner, `IMPORT_MATCH_MIN` 0.95 / `IMPORT_REVIEW_MIN` 0.8 / `IMPORT_NEAR_TIE` 0.05), `limits.ts`. `__fixtures__/make-fixture.ts` builds synthetic `[audit]` backups | — (the apply step lives in `components/media/import/`) |
| `tags.ts` | tag CRUD, validation, palette, per-entity `set*Tags`, `searchByTag` | `tags` + the six junctions |
| `themes.ts` | theme families and `applyTheme` / `getCurrentTheme` / `saveTheme` | — |
| `title-match.ts` | pure: `titleSimilarity` (bigram Dice), `hitMatchesTitle`, `TITLE_MATCH_MIN` 0.6 — a cover / metadata hit must match the typed title | — |
| `utils.ts` | `cn`, `sanitizeHtml`, `sanitizePreview`, `getContrastTextColor` | — |
| `vault.ts` | folder tree, uploads, rename / move / star / delete, signed URLs, zip downloads; `MAX_FILE_BYTES` 25 MB | `vault_folders`, `vault_files`; Storage `vault` |
| `wishlist.ts` | wishlist CRUD, price history, deal detection, `isMissingTableError` | `wishlist_items` |
| `work.ts` | work projects, stats and people rollups, duration helpers, `isMissingTableError` | `work_projects` |

Outside `lib/`: `integrations/supabase/client.ts` (the only client; session in localStorage, auto
refresh), `integrations/supabase/types.ts` (schema types), `types/calendar.ts`.

## Hooks and contexts

| File | What |
|---|---|
| `hooks/useAuth.tsx` | `{ user, loading, signIn, signUp, signOut }`; `getSession` + `onAuthStateChange`; sign-in/out toasts |
| `hooks/usePreferences.tsx` | `{ prefs, loading, update(patch), resetAppearance() }`; applies cached prefs at mount, hydrates from Supabase; `update` applies to the DOM and saves |
| `hooks/useCalendar.ts` | `get_calendar_events` for the visible range (stale responses ignored), client-side filters; `{ events, loading, error, filters, setFilters, refetch }` |
| `hooks/use-document-title.ts` | sets `"<title> · NoteHaven"` (PageShell and the bespoke pages) |
| `hooks/use-media-query.ts`, `hooks/use-mobile.tsx` | `matchMedia` boolean; `useIsMobile()` = max-width 767 px |
| `hooks/use-toast.ts` | shadcn toast store (features import `@/components/ui/use-toast`) |
| `contexts/SidebarContext.tsx` | collapse state in `notehaven_sidebar_collapsed`, synced across tabs; collapsed by default under 1024 px |
| `pages/settings/useProfile.ts` | display name, email and avatar from the auth user's metadata |
| `hooks/media/useMediaLibrary.ts` | the paged library: `useInfiniteQuery` `['mediaItems', status, search, sortBy, sortOrder]` over `media_tracker` + tags, 200 per page, exact count, `keepPreviousData` |
| `hooks/media/useProgressMutation.ts` | the React side of logging: optimistic cache patches, per-title write chaining, toasts; the write itself is `lib/media-progress-write.ts` |

Other Media query keys: `['mediaRails']` (150 active rows by activity, 60 s), `['groupCounts', groups]`
(type / status counts, paged, 30 s), `['sourceMeta', source, id]` (linked detail, 10 min),
`['mediaHistory']` (History, infinite, 30 s), `['mediaTitleIndex']` (every title, paged, only while Browse or
Fix match is open: the "In library" marks), `['mediaBulkLatest']` (the newest undoable bulk batch), `['mediaUpdates']` (the Updates feed),
`['mediaWrongCovers']` (the review and its count), `['mediaStatsAll']` (Library stats over every row). Covers and legacy metadata are `useState` maps, not queries.

## Components

- **Top level:** `AppSidebar` (glass nav rail, ⌘K button, hover prefetch, drag-orderable, collapsible,
  slide-over on mobile), `PageShell` (props `title`, `subtitle`, `icon`, `actions`, `mobileActions`,
  `fullHeight`, `noPadding`, `maxWidth`, `contentClassName`, `documentTitle`), `CommandPalette` (cmdk:
  navigate, four "create" actions, light/dark toggle), `AuroraBackdrop`, `RouteFallback`,
  `ProtectedRoute`, `ConfirmDialog` (every destructive action), `CodeEditor` (CodeMirror 6, languages
  loaded lazily, one-dark in dark mode), `TagBadge`, `CompactTagSelector` (Library, Media, Notes, Tasks,
  Work), `TagFilter` (Library, Notes, Tasks; AND semantics), `TagCloud` (TagsWidget).
- **`calendar/`:** `MonthView`, `WeekView`, `AgendaView`, `CalendarHeader`, `DayDetailModal` + `DayDetail`, `QuickAddDialog`.
- **`dashboard/`:** `WidgetManager`, `WidgetWrapper` (card chrome for 12 of the 13 widgets; Stats renders
  its own), `MasonryItem`, `CircularProgress`, `widgets/*`.
- **`ledger/`:** `AccountsManager`, `LedgerCharts`, `LedgerEntryForm`.
- **`library/`:** `CommandsTab` (+ `MoveToCommandsDialog`).
- **`media/`:** sections `MediaSectionNav`, `LibraryGrid`, `HistoryView`, `MediaMoreView`; detail
  `MediaDetailPanel`, `MediaDetailView`, `MediaEditForm`, `MediaActionsMenu`; logging `ProgressControl`,
  `LogSheet` (+ `LogNumberButton`), `LogPanel`, `WatchedToggle`; Browse `SourcePicker`, `PickPreview`;
  `UpdatesView`; covers `ChangeCover`, `WrongCovers`, `CoverArt` (image with the letter-tile fallback),
  `cover-row.ts`; review `ReviewCard` (shared by the import and the link queue); rails and dialogs
  `ContinueShelf`, `AiringSoon`, `GenreRail`, `CustomGroupBuilder`, `LibraryStatsDialog`; helpers `types.ts` (`MediaItem` incl. the migration 28 fields), `grid-size.ts`,
  `progress-view.ts` (pure: `latestParts`, `latestOf`, `behindCount`, `behindBadge`, `boundsFor`),
  `source-meta.ts` (`buildMetaIndex` / `metaFor`, `detailToMeta`, `mergeMeta`), `history-labels.ts` (pure),
  `picker-utils.ts`, `media-style.ts`. `import/`: `ReaderImportDialog`, `ImportPreview`, `apply.ts`,
  `import-inputs.ts`, `selection.ts` (pure), `sniff.ts` (pure), `useBackupGate.ts` + `BackupNote` (the
  shared backup gate). `link/`: `LinkBar`, `AutoMatched`, `LinkQueue`, `useLinkRun`, `useLinkApprove`,
  `apply-links.ts`, `link-data.ts`. Gone: `MediaCard`, `RefreshLibraryDialog`.
- **`recipes/`:** `DictateParse`, `PantryPanel`. **`settings/`:** `primitives.tsx`.
- **`vault/`:** `VaultFileCard`, `VaultFolderCard`, `FilePreviewModal`, `MoveToFolderDialog`, `DuplicateResolveDialog`.
- **`work/`:** `ProjectCard`, `ProjectTable`, `PeopleInput`.
- **`ui/`:** a trimmed shadcn set (alert-dialog, badge, button, card, checkbox, command, dialog,
  dropdown-menu, hover-card, input, label, popover, progress, select, separator, sheet, skeleton, switch,
  tabs, textarea, toast, toaster, tooltip) plus custom `DatePicker`, `empty-state`, `filter-pill.ts`
  (`filterPill(active)` class helper) and `motion.tsx`. `button` adds `variant="gradient"`. There is no
  chart, form or sonner primitive.

## Styling, themes and preferences

- **Tokens:** HSL CSS variables on `:root` and `.dark` in `src/index.css`, mapped in `tailwind.config.ts`
  (`hsl(var(--x))`, plus `shadow-glow*`). Aurora adds `--accent-2[-hover]`, `--glow`,
  `--gradient-brand[-soft]`, `--glow-sm/md/lg`. Font: Inter (Google Fonts).
- **Utilities** (`index.css`): `.gradient-text[-soft]`, `.bg-gradient-brand[-soft]`, `.zen-card`,
  `.aurora-card`, `.glass` / `.glass-strong`, `.glow`, `.chip-tint`, `.hover-lift`, `.loading-shimmer`,
  `.animate-fade-in`, `.animate-glow-pulse`, `.animate-float`, `.stagger-item`, `.animate-route`; Tiptap
  styles under `.ProseMirror`, `#rich-editor`, `.note-preview`.
- **Theme families** (`lib/themes.ts`): `aurora` (default), `netflix`, `prime`, each with a light and a
  dark palette. `applyTheme(name, mode)` disables transitions, writes every token inline on `<html>`,
  reskins `--sidebar-*`, and sets `data-theme="<name>-<mode>"`. Legacy names migrate to aurora.
- **Mode:** `localStorage.theme` = `light` | `dark` | `system` (unset = dark). An inline script in
  `index.html` adds `.dark` before first paint; the full palette arrives on mount. The command palette's
  toggle writes only `light` / `dark`.
- **Preferences** (`lib/preferences.ts`): one `AppPreferences` object (accent, font size, radius, reduced
  motion, background effects, high contrast, underlined links, focus rings, readable font, start page,
  currency, locale), stored in `localStorage.app_preferences` for first paint and in `user_preferences`
  (`app_preferences`) across devices; the remote copy wins on load. `applyPreferencesToDOM` overrides
  `--primary` / `--ring` / `--glow` from the accent, rescales `--radius*`, sets the root font size and
  toggles `.reduce-motion`, `.high-contrast`, `.underline-links`, `.always-focus`, `.dyslexia-font`.
- **Motion:** framer-motion via `components/ui/motion.tsx` (`PageTransition`, `FadeIn`, `Stagger`,
  `StaggerItem`, `staggerItem` variants). `prefers-reduced-motion` and the reduce-motion preference both
  neutralise animation, including the backdrop.

## localStorage keys

One `sessionStorage` key: `notehaven.fullExportAt` (`lib/full-export.ts`, the per-tab "complete export
in this session" stamp that bulk dialogs gate on).

| Key | Owner |
|---|---|
| `theme`, `app-theme` | `lib/preferences.ts`, `lib/themes.ts`, `index.html`, `CommandPalette` |
| `app_preferences` | `lib/preferences.ts` |
| `notehaven_sidebar_collapsed` | `contexts/SidebarContext.tsx` |
| `sidebar-order` | `AppSidebar`, `settings/SidebarSection` |
| `dashboard_fill_space` | `Dashboard`, `settings/DashboardSection` |
| `calendar_filters` | `hooks/useCalendar.ts` |
| `library-active-tab` | `Library`, `settings/BehaviorSection` |
| `mediaTrackerViewMode`, `mediaTrackerActiveCategory`, `mediaTrackerVisibleTypeTabs`, `mediaTrackerCustomGroups`, `mediaTrackerSortBy`, `mediaTrackerSortOrder`, `mediaShowRails`, `media_meta_light_v1` | `MediaTracker` (view mode and sort also set from Behavior) |
| `mediaGridSize` (`S` / `M` / `L`) | `media/grid-size.ts` |
| `mediaLinkRun:v1` (`running` / `paused`) | `media/link/useLinkRun.ts` (this device's Link-your-library intent; the progress itself is on the server) |
| `mediaImportCategoryMap:v1` | `media/import/import-inputs.ts` (reader shelf → status; device-only, never synced) |
| `media_images_v2`, `media_image_sources_v2`, `media_images_stamp_v2` | `lib/image-cache.ts` |
| `ledgerLastAccountId`, `ledgerSelectedMonth`, `ledgerSelectedYear` | `MoneyLedger` |
| `recipesPantry` | `Recipes` |
| `vault-view` | `Vault`, `settings/BehaviorSection` |
| `work-projects-view` | `Work` |
| `sb-<project-ref>-auth-token` | the Supabase client (session) |

## Window events

| Event | Dispatched by | Heard by |
|---|---|---|
| `open-command-palette` | `AppSidebar` search button, `settings/KeyboardSection` | `CommandPalette` |
| `sidebar-order-changed` | `settings/SidebarSection` (save / reset) | `AppSidebar` |

## Build and tooling

- **Vite** (`vite.config.ts`): dev server on host `::`, port 8080; `@vitejs/plugin-react-swc`;
  `lovable-tagger` in development mode only; alias `@` → `./src`. `manualChunks` splits `editor` (Tiptap +
  ProseMirror), `codemirror` (core only — each language grammar is its own lazy chunk), `charts`
  (recharts / d3), `motion`, `icons`, `supabase`, `query` and `react-vendor`.
- **PWA** (`vite-plugin-pwa`): `autoUpdate`; dark `#141414` theme and background colours; Workbox
  precaches the build (except the import's `parse.worker-*.js`, fetched only when used) and runtime-caches Google Fonts (CacheFirst, 1 year) and `*.supabase.co`
  (NetworkFirst, 10 s timeout, 5 min / 50 entries).
- **TypeScript:** `tsconfig.app.json` covers `src/` and is loose (`strict: false`). The root
  `tsconfig.json` only holds references (`files: []`), so run `npm run typecheck`, not bare `tsc`.
- **ESLint** (`eslint.config.js`, flat config): JS + typescript-eslint recommended, react-hooks
  recommended, `react-refresh/only-export-components` as a warning, `@typescript-eslint/no-unused-vars` off.
- **Tests:** Vitest (`npm test`, `vitest.config.ts`: node environment, `@/` alias, separate from
  `vite.config.ts`) runs `src/**/*.test.ts` and `supabase/functions/**/*.test.ts`: `lib/__tests__/`
  (`media-match`, `media-progress`, `media-progress-write`, `media-link`, `media-bulk`, `full-export`,
  `restore`; stubbed clients), `lib/tachimanga/__tests__/` (`parse-core` against synthetic fixtures run
  through real sql.js, `plan`), `components/media/__tests__/` (`import-apply`, `import-selection`,
  `import-sniff`, `progress-view`, `status`) and the edge `adult.test.ts`. Fixtures are synthetic
  `[audit]` data only. `scripts/__tests__/media-insights.test.ts` (`npm run test:insights`) stays a plain
  `tsx` script over `lib/media-insights` and `lib/media-progress`.
- **CI:** `.github/workflows/ci.yml` (GitHub Actions, Node 20): `npm ci` → lint → `test:insights` →
  `npm test` → build → esbuild parse of the edge function.
