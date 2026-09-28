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
          └ RefreshActivityProvider   contexts/RefreshActivityContext.tsx
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
- `RefreshActivityProvider` sits above the router so a media "Refresh Library" sweep keeps running
  across navigation.

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
| `/media` | `MediaTracker` | 🔒 | B | edge-function, simple-image-fetcher, media-refresh, media-metadata, media-insights, tags | `media_tracker` (inline), `media_metadata`, `media_tags`; edge function |
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

**Deep links:** `/notes?new=1`, `/tasks?new=1`, `/tasks?task=ID`, `/media?new=1`, `/work?new=1`,
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
- **MediaTracker:** `useInfiniteQuery` over `media_tracker` (200 per page, intersection-observer scroll,
  key `['mediaItems', …]`) plus `['mediaRails']` and `['groupCounts']` queries. Types: Movie, Series,
  Anime, Manga, Manhwa, Manhua, KDrama, JDrama; statuses: Watching, Reading, Plan to Watch, Plan to Read,
  Completed. Grid (grouped Active / Planned / Completed) or list view; custom type groups
  (`CustomGroupBuilder`); rails (`ContinueShelf`, `AiringSoon`, `GenreRail`, toggled by `mediaShowRails`);
  genre, progress (all / behind / new) and needs-cover filters; debounced search; sort. Quick add is a
  Dialog; the right-hand Sheet is the details/edit panel. Optimistic episode/chapter increments and
  status changes; bulk status, delete and cover refresh; JSON import; JSON / CSV / TXT export.
  `LibraryStatsDialog` shows breakdowns; `RefreshLibraryDialog` starts a background metadata sweep
  (`RefreshActivityContext`) that fills missing covers and metadata but never overwrites. The tag
  *filter* is gone (genres replaced it); the edit form still has a tag selector.
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
- **Settings:** a searchable rail (`?section=`, default `account`) over twelve section files in
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
  | Data | JSON backup of every user table + tag junctions (paged past PostgREST's 1000-row cap); restore (**known-broken** for ledger entries, subscriptions and categories — `docs/BACKLOG.md`); Vault usage; clear the cover cache |
  | Sync activity | live view of the media refresh sweep: progress, per-item results, retry |
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
| `edge-function.ts` | `mediaSearchGet` / `mediaSearchUrl`: authenticated GET to `media-search`; `null` on no session, non-2xx or network error | edge function |
| `image-cache.ts` | localStorage cover cache with a 24 h TTL, merge-on-write | — |
| `ledger.ts` | entries CRUD, monthly summary (RPC + derived subscription charges), CSV/JSON export, `formatCurrency` | `ledger_entries`, `subscriptions`; RPC `get_monthly_ledger_summary` |
| `logger.ts` | `devLog` (dev-only logging) | — |
| `media-insights.ts` | pure derivations: continue queue, airing soon, genres, library stats, duplicates (unit-tested) | — |
| `media-metadata.ts` | reads the metadata cache, runs the Refresh Library sweep, acknowledges new content | `media_metadata`, `media_tracker`; edge function |
| `media-progress.ts` | pure progress types + `computeProgress` (kept apart so tests don't import the client) | — |
| `media-refresh.ts` | per-item cover cycling through sources by type | AniList, Kitsu, Jikan, TVmaze direct; TMDB, Wikidata, Fanart via the edge function; writes `media_tracker.cover_image` + `media_metadata` |
| `pantry-match.ts` | "cook with what I have" scoring (pure) | — |
| `preferences.ts` | the `AppPreferences` blob, light/dark/system mode, `applyPreferencesToDOM` | localStorage + `user_preferences` (`app_preferences`) |
| `recipe-parse.ts` | free-text → recipe parser (pure) | — |
| `recipes.ts` | recipes and folders, TheMealDB search / import, image suggestions | `recipes`, `recipe_folders`; TheMealDB; Openverse |
| `route-prefetch.ts` | `prefetchRoute`: warm a lazy route chunk on nav hover / focus | — |
| `secret-mask.ts` | pure secret masking for the snippet viewer | — |
| `simple-image-fetcher.ts` | batched cover lookup: cache → `media_tracker.cover_image` → `media_metadata` → edge function (10 at a time, chunked `IN`) | `media_tracker`, `media_metadata`; edge function |
| `subscriptions.ts` | subscriptions and categories, renewal maths, summary, status labels; `getUpcomingRenewals` (Dashboard) | `subscriptions`, `subscription_categories`; RPC `get_upcoming_renewals` |
| `tags.ts` | tag CRUD, validation, palette, per-entity `set*Tags`, `searchByTag` | `tags` + the six junctions |
| `themes.ts` | theme families and `applyTheme` / `getCurrentTheme` / `saveTheme` | — |
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
| `contexts/RefreshActivityContext.tsx` | the global media sweep runner (`start`, `retry`, `clear`, progress, items); one sweep at a time; invalidates `['groupCounts']` and `['mediaItems']` when done |
| `pages/settings/useProfile.ts` | display name, email and avatar from the auth user's metadata |

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
- **`media/`:** `MediaCard`, `CustomGroupBuilder`, `ContinueShelf`, `AiringSoon`, `GenreRail`,
  `LibraryStatsDialog`, `RefreshLibraryDialog`, `media-style.ts`.
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

No `sessionStorage` is used.

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
| `media_refresh_options_v1` | `media/RefreshLibraryDialog` |
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
  precaches the build and runtime-caches Google Fonts (CacheFirst, 1 year) and `*.supabase.co`
  (NetworkFirst, 10 s timeout, 5 min / 50 entries).
- **TypeScript:** `tsconfig.app.json` covers `src/` and is loose (`strict: false`). The root
  `tsconfig.json` only holds references (`files: []`), so run `npm run typecheck`, not bare `tsc`.
- **ESLint** (`eslint.config.js`, flat config): JS + typescript-eslint recommended, react-hooks
  recommended, `react-refresh/only-export-components` as a warning, `@typescript-eslint/no-unused-vars` off.
- **Tests:** `scripts/__tests__/media-insights.test.ts` (`npm run test:insights`) — plain `tsx` with
  hand-rolled assertions over `lib/media-insights` and `lib/media-progress`. No test framework.
- **CI:** `.github/workflows/ci.yml` (GitHub Actions, Node 20): `npm ci` → lint → `test:insights` →
  build → esbuild parse of the edge function.
