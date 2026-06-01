# NoteHaven — Frontend Context

> Personal productivity & media companion. Single-page React app (Vite + TypeScript) backed by Supabase. This document captures the full frontend picture: stack, structure, routing, state, styling, every feature page, shared components, and the data-access layer the UI relies on.

---

## 1. Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 18 (function components + hooks) |
| Language | TypeScript 5.8 |
| Build tool | Vite 5 (`@vitejs/plugin-react-swc`) |
| Styling | Tailwind CSS 3 + custom "Zen Garden" design tokens (HSL CSS vars) |
| UI primitives | shadcn/ui (Radix UI under the hood) — ~50 components in `src/components/ui` |
| Icons | lucide-react |
| Server state | TanStack React Query v5 (used heavily only in MediaTracker; most pages use manual `useState` + `useEffect`) |
| Routing | react-router-dom v6 |
| Animation | framer-motion + hand-written CSS keyframes in `index.css` |
| Rich text | Tiptap v2 (StarterKit + Underline + Gapcursor) for Notes |
| Code editor | CodeMirror 6 for Code Snippets |
| Forms/validation | react-hook-form + zod (libs present; most forms are manual `useState`) |
| HTML sanitization | DOMPurify (`sanitizeHtml`, `sanitizePreview` in `lib/utils.ts`) |
| Dates | date-fns + custom IST-safe helpers in `lib/date-utils.ts` |
| PWA | vite-plugin-pwa (autoUpdate, Workbox runtime caching) |
| Charts | recharts (only via `ui/chart.tsx`; not actively used by features) |
| Package manager | bun (`bun.lockb`) |

Path alias: `@/` → `src/`.

---

## 2. Application Entry & Providers

`src/main.tsx` → renders `<App/>` into `#root`.

`src/App.tsx` composes the provider tree (outer → inner):

```
QueryClientProvider
  └ AuthProvider              (src/hooks/useAuth.tsx)
     └ SidebarProvider        (src/contexts/SidebarContext.tsx)
        └ TooltipProvider
           ├ Toaster          (shadcn toast)
           ├ Sonner           (sonner toast)
           └ BrowserRouter → AppInner (Routes)
```

`AppInner` also applies the saved theme on mount (reads `localStorage.theme` for light/dark and `app-theme` for the color theme, then calls `applyTheme`).

> Note: there are **two toast systems mounted at once** — shadcn `Toaster` (`use-toast`) and `Sonner`. Only `use-toast` is actually used by feature code.

---

## 3. Routing Map

All app routes are wrapped in `<ProtectedRoute>` except auth/public ones.

| Path | Component | Notes |
|---|---|---|
| `/` | `Index` | Immediately redirects to `/login` |
| `/login` | `Login` | Email/password, animated glass card |
| `/signup` | `SignUp` | |
| `/check-email` | `CheckEmail` | Post-signup info screen |
| `/dashboard` | `Dashboard` | Widget grid |
| `/prompts` | **`Library`** | ⚠️ routes to Library, not Prompts |
| `/library` | `Library` | Prompts + Code Snippets tabs |
| `/media` | `MediaTracker` | |
| `/tasks` | `Tasks` | |
| `/notes` | `Notes` | |
| `/notes/share/:shareId` | `SharedNote` | Public, **not** protected |
| `/settings` | `Settings` | |
| `/birthdays` | `Birthdays` | |
| `/tags/:tagName` | `TagView` | Cross-feature tag search |
| `/ledger` | `MoneyLedger` | |
| `/subscriptions` | `Subscriptions` | |
| `/calendar` | `Calendar` | |
| `*` | `NotFound` | Links back to `/login` |

`ProtectedRoute` shows a pulse skeleton while `useAuth().loading`, then redirects to `/login` if no user.

`src/pages/Prompts.tsx` exists and is imported in `App.tsx` but **is not reachable** (both `/prompts` and `/library` render `Library`). It's effectively dead code superseded by the Library page's Prompts tab.

---

## 4. Authentication (`src/hooks/useAuth.tsx`)

- Context exposes `{ user, loading, signIn, signUp, signOut }`.
- On mount: `supabase.auth.getSession()` + `onAuthStateChange` subscription; `loading` resolves on whichever fires first (`resolveInitial`).
- `signIn` → `signInWithPassword`, then re-fetches user so `display_name` metadata is fresh; toasts success/error.
- `signUp` → `supabase.auth.signUp`; redirect handled in `SignUp.tsx` (no toast).
- `signOut` → `supabase.auth.signOut`.
- Session persisted in `localStorage` (configured in the Supabase client).

---

## 5. Layout & Navigation

### Sidebar (`src/components/AppSidebar.tsx`)
- Fixed left nav, `lg:sticky`. Collapsible on desktop, slide-over on mobile (overlay + `X`).
- Collapsed state lives in `SidebarContext` (persisted to `localStorage` key `notehaven_sidebar_collapsed`, synced across tabs via `storage` event; defaults collapsed under 1024px).
- Nav order is user-customizable via Settings (drag-and-drop), persisted to `localStorage` key `sidebar-order`, and broadcast through a custom `sidebar-order-changed` window event that the sidebar listens for.
- Main items: Dashboard, Calendar, Library, Media, Tasks, Notes, Birthdays, Money Ledger, Subscriptions. Bottom: Settings + Logout.
- Collapsed items show a hover tooltip implemented with `group-hover` utility classes (not the Radix Tooltip).

> `iconMap` constant is declared in AppSidebar but never read (each nav item carries its own `icon`). Dead code.

### Page header pattern
Most pages render their own mobile header (`lg:hidden` sticky bar with a hamburger `Menu` button calling `toggleSidebar`) plus a desktop header. **Exceptions** — `MoneyLedger`, `Subscriptions`, and `Calendar` have no mobile hamburger header, so on mobile (sidebar collapsed) there's no in-page way to open the sidebar. See the audit for impact.

---

## 6. Styling System (`src/index.css` + `tailwind.config.ts` + `lib/themes.ts`)

- **Design tokens**: HSL CSS variables on `:root` and `.dark`. Tailwind colors map to `hsl(var(--token))`.
- **Fonts**: Poppins (`font-heading`), Inter (`font-body`), loaded from Google Fonts in `index.html`.
- **Color themes**: 4 themes in `lib/themes.ts` — `zen-garden` (default), `ocean-breeze`, `sunset-glow`, `forest-mist`. Each defines a full light + dark palette. `applyTheme(name, mode)` writes every token to `document.documentElement` inline styles (temporarily disabling transitions to avoid flash). Saved to `localStorage` key `app-theme`; light/dark saved under `theme`.
- **Utility classes**: `.zen-card`, `.zen-shadow`, `.zen-shadow-lg`, `.zen-transition`, hover-lift/scale, fade/slide keyframe animations, `.stagger-item` nth-child delays, `.loading-shimmer`.
- **Editor styles**: global `.ProseMirror` (Tiptap) and `#rich-editor`/`.note-preview` list styling.
- **Accessibility**: `prefers-reduced-motion` block neutralizes animations; focus-visible outlines defined globally.

> Theme application is done two ways: inline CSS vars via `applyTheme` (themes.ts) AND the static `:root`/`.dark` blocks in `index.css`. They can diverge (the static block is the zen-garden palette). Light/dark toggling relies on the `.dark` class plus `applyTheme` re-running with the chosen color theme.

---

## 7. Feature Pages

### Dashboard (`pages/Dashboard.tsx`)
- Customizable **widget grid** (4-col responsive). Widget config (type, visible, position, size) loaded/saved via `lib/dashboard.ts` to the `user_preferences` table (key `dashboard_widgets`); falls back to `DEFAULT_WIDGETS`.
- Widgets: stats, tasks, notes, media, prompts, pinned, tags, countdowns, birthdays, subscriptions, calendar-mini, ledger. Each is a component in `components/dashboard/widgets`.
- `WidgetManager` modal: toggle visibility, drag to reorder (HTML5 drag), set width (1/4–full). Layout reset available.
- Data is fetched with a big `Promise.all` of inline Supabase queries (tasks, notes, media, prompts, pinned, countdowns, birthdays), plus tags, renewals, ledger summary, and synthesized calendar events.
- ⚠️ `fetchLedgerSummary` queries the `ledger_entries` table filtering on a **`date`** column that does not exist (schema column is `transaction_date`). This query errors and is swallowed by a try/catch, so the ledger widget silently shows nothing. See audit.

### Notes (`pages/Notes.tsx`) — ~1300 lines
- Two-pane master/detail (list + Tiptap editor); single-pane with toggle on mobile.
- **Auto-save** with 2s debounce per field (title/content), conflict detection against `updated_at`, optimistic local state, and Supabase **realtime** subscription for multi-tab sync (guards against overwriting unsaved local edits via `hasLocalChangesRef`/`localEditTimestampRef`).
- An "Inbox" note is auto-created and pinned to the top of the list.
- Rich text via Tiptap; HTML persisted directly. Toolbar: bold/italic/underline, lists, undo/redo, color/category palette.
- **Note categories** = colored sticky-note styling stored in `background_color` (yellow/green/blue/... with light/dark bg + left border). Word/line counts computed by stripping HTML.
- **Sharing**: creates a row in `shared_notes`, builds `/notes/share/:id` link, optional `allow_edit`.
- Tagging via `CompactTagSelector`; filter via `TagFilter`. Pagination constant (50) exists.

### Tasks (`pages/Tasks.tsx`)
- Add form (text + `DatePicker` due date + tags). To-Do and Completed sections, pinned-first sorting, overdue highlighting (red).
- Toggle complete (optimistic), pin/unpin, edit (Dialog), delete (`ConfirmDialog`).
- Tag filtering with AND semantics. Supports `?task=ID` deep link (scrolls + ring highlight).
- Tags shown only on hover (`opacity-0 group-hover:opacity-100`).

### Library (`pages/Library.tsx`) — Prompts + Code Snippets tabs
- Active tab persisted to `localStorage` (`library-active-tab`).
- **PromptsTab**: card grid, category filter buttons (derived from data), tag filter, copy-to-clipboard, favorite (star), pin, edit/create via Dialog, delete via `ConfirmDialog`.
- **SnippetsTab**: list grouped by language (collapsible groups), search, CodeMirror viewer/editor (`CodeEditor`), favorite, pin, copy, create/edit/delete. Data layer in `lib/codeSnippets.ts`.

### MediaTracker (`pages/MediaTracker.tsx`) — ~1900 lines, the most complex page
- Uses React Query `useInfiniteQuery` (page size 200, intersection-observer infinite scroll) for `media_tracker`.
- Types: Movie, Series, Anime, Manga, Manhwa, Manhua, KDrama, JDrama. Statuses: Watching, Reading, Plan to Watch, Plan to Read, Completed. Runtime normalization defaults invalid values.
- **Views**: grid (cards grouped by status category Active/Planned/Completed) and list (table). View mode + active tab + visible type tabs all persisted to `localStorage`.
- **Custom groups**: user-defined type groupings via `CustomGroupBuilder`, persisted to `localStorage`.
- **Cover images**: lazy-loaded per visible item through `lib/simple-image-fetcher.ts` (localStorage cache → `media_tracker.cover_image` → `media_metadata` → edge function/external APIs). Per-card "refresh cover" cycles APIs via `lib/media-refresh.ts`.
- Quick add (Sheet), full create/edit, quick episode/chapter increment (optimistic cache update), quick status change, bulk select + bulk cover refresh, import, JSON export, TXT export (with type filter), "needs cover only" filter, search (debounced), sort asc/desc.

### MoneyLedger (`pages/MoneyLedger.tsx`)
- Month/year + type filters, summary cards (income/expense/net), transactions table.
- Add/Edit via Dialogs. Categories auto-seeded via `ensureLedgerCategoriesExist` (`lib/category-init.ts`). CSV/JSON export. Currency formatted as INR.
- ⚠️ No mobile hamburger header (no sidebar access on mobile). The two Dialogs are both always mounted in the header area.

### Subscriptions (`pages/Subscriptions.tsx`)
- Summary cards (monthly cost, yearly cost, active count, **and a 4th "Total Monthly" card that duplicates monthly cost**). List with status dots, renewal countdown, edit/delete.
- A DB trigger auto-creates a linked `ledger_entries` row (per `lib/subscriptions.ts` comments). Categories auto-seeded.
- ⚠️ No mobile hamburger header.

### Calendar (`pages/Calendar.tsx` + `components/calendar/*` + `hooks/useCalendar.ts`)
- Month/Week views. Events fetched via the `get_calendar_events` Postgres RPC (unified across tasks, birthdays, subscriptions, countdowns, media, notes), filtered client-side by `CalendarFilters`.
- `MonthView`: 7-col grid, weekend tinting, today highlight, up to 4 events/day + "+N more", HoverCard preview. `WeekView`, `CalendarHeader` (nav + filter legend), `DayDetailModal`, `QuickAddDialog`, `CalendarFilters`.
- ⚠️ No mobile hamburger header.

### Birthdays (`pages/Birthdays.tsx`)
- Sections: Upcoming (next 5), Recent (past 3), All (sorted by month/day). Cards show age + days-until with a pulse on the actual day.
- Add/Edit modal uses 3 cascading Selects (year → month → day). Search by name. Delete via `ConfirmDialog`. **The entire add/edit Dialog is duplicated** in the mobile and desktop headers.

### Settings (`pages/Settings.tsx`)
- Appearance (color theme Select + light/dark Switch), Sidebar order (drag-and-drop, collapsible section), Profile (display name → user metadata), Security (password update), Data Management (JSON export of prompts/notes/tasks/media), External Links (hard-coded WeebsList link).

### TagView (`pages/TagView.tsx`)
- Renders all items (notes/tasks/media/prompts/snippets) carrying a given tag (`searchByTag` in `lib/tags.ts`).

### Auth/util pages
- `Login`, `SignUp`, `CheckEmail`, `Index` (redirect), `NotFound`, `SharedNote` (public collaborative note via `contentEditable` + realtime).

---

## 8. Shared Components

| Component | Purpose |
|---|---|
| `AppSidebar` | Main navigation (see §5) |
| `ProtectedRoute` | Auth gate |
| `ConfirmDialog` | Reusable destructive-action confirm (AlertDialog) |
| `CodeEditor` | CodeMirror 6 wrapper (lang extensions, one-dark in dark mode, read-only support) |
| `TagBadge` | Colored pill with contrast-aware text, optional remove |
| `CompactTagSelector` | Inline tag add/create dropdown (used by Notes/Tasks/Library forms) |
| `TagFilter` | Dropdown multi-select tag filter (AND semantics) |
| `TagCloud` | Usage-weighted tag cloud (used by Dashboard TagsWidget) |
| `TagInput` | Fuller tag input w/ keyboard nav + autocomplete — **not imported anywhere** (dead) |
| `QuickTagButtons` | Top-5 tag quick toggles — **not imported anywhere** (dead) |
| `dashboard/WidgetManager` | Customize dashboard modal |
| `dashboard/WidgetWrapper` | Widget chrome (title, size menu, loading skeleton) — note Dashboard renders widgets directly and does not use this wrapper's editing UI |
| `dashboard/CircularProgress` | Task-completion ring |
| `dashboard/widgets/*` | 12 widget components |
| `media/MediaCard` | Poster card w/ hover actions, lazy `useInView`, cover refresh |
| `media/CustomGroupBuilder` | Build/manage custom media type groups |
| `calendar/*` | Calendar views, header, modals, filters |
| `ui/*` | shadcn primitives (~50) |

### Three overlapping tag-selection components
`TagInput`, `CompactTagSelector`, and `QuickTagButtons` solve very similar problems. Only `CompactTagSelector` (+ `TagFilter`, `TagCloud`) is wired into pages. `TagInput` and `QuickTagButtons` are unused.

---

## 9. Hooks & Contexts

- `useAuth` — auth context (§4).
- `SidebarContext` / `useSidebar` — collapse state + persistence + cross-tab sync.
- `useCalendar` — fetches calendar events via RPC, holds filters, exposes `refetch` and `updateTaskDueDate`.
- `use-media-query` — generic `matchMedia` hook.
- `use-mobile` — `useIsMobile()` (max-width 767). Note: several pages also implement their own ad-hoc `window.innerWidth` checks instead of using this hook.
- `use-toast` — shadcn toast store.

---

## 10. Client Data-Access Layer (`src/lib/*`)

The UI talks to Supabase almost entirely through these modules (and inline `supabase.from(...)` calls in pages). See `backend.md` for table/column detail.

| Module | Responsibility |
|---|---|
| `tags.ts` | Tag CRUD, validation/normalization, per-entity assignment (note/task/media/prompt/snippet), `searchByTag`, color palette |
| `ledger.ts` | Ledger categories + entries CRUD, monthly summary (RPC + client calc), CSV/JSON export, INR formatting |
| `subscriptions.ts` | Subscription + category CRUD, next-renewal calc, summary, status labels/colors, upcoming-renewals RPC |
| `dashboard.ts` | Widget definitions/metadata, default layout, load/save/reset to `user_preferences` |
| `codeSnippets.ts` | Code snippet CRUD + tag wiring, supported languages |
| `category-init.ts` | Seed default ledger/subscription categories on first use |
| `calendar.ts` | Event color/label/icon maps, grouping helpers |
| `media-api.ts` | Search via edge function with Jikan fallback (uses axios + fetch) |
| `media-refresh.ts` | Multi-API cover cycling (AniList, Jikan, Kitsu, MangaUpdates-via-proxy, TMDB, OMDB) + cache invalidation |
| `simple-image-fetcher.ts` | Batched cover loading w/ localStorage cache and DB-first strategy |
| `date-utils.ts` | IST-safe `YYYY-MM-DD` parse/format helpers (avoid `toISOString` UTC drift) |
| `error-utils.ts` | `getErrorMessage`, `isError` |
| `themes.ts` | Theme palettes + `applyTheme`/`getCurrentTheme`/`saveTheme` |
| `utils.ts` | `cn`, DOMPurify sanitizers, contrast-color helper |

---

## 11. localStorage Keys (UI persistence)

| Key | Used by |
|---|---|
| `theme` | light/dark mode |
| `app-theme` | active color theme |
| `notehaven_sidebar_collapsed` | sidebar collapse |
| `sidebar-order` | sidebar nav order |
| `library-active-tab` | Library tab |
| `mediaTrackerViewMode`, `mediaTrackerActiveTypeTab`, `mediaTrackerVisibleTypeTabs`, `mediaTrackerCustomGroups` | MediaTracker |
| `media_images_v1`, `media_image_sources_v1` | cover image cache |

---

## 12. Build / Run

```bash
bun install
bun run dev        # Vite dev server (configured host "::", port 8080)
bun run build      # production build
bun run build:dev  # development-mode build
bun run lint       # eslint
bun run preview     # preview built app
```

Required env (Vite, `VITE_` prefixed are public/client): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID`. Optional: `TMDB_API_KEY`, `OMDB_API_KEY` (note these are read in client code via `import.meta.env` in `media-refresh.ts` but are not `VITE_`-prefixed, so they're effectively undefined at runtime — see audit).

PWA: service worker auto-update; caches Google Fonts (CacheFirst) and Supabase API (NetworkFirst, 5min).
