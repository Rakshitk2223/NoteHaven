# NoteHaven — Frontend Context

> Personal productivity & media companion. Single-page React app (Vite + TypeScript) backed by Supabase. This document captures the full frontend picture: stack, structure, routing, state, styling, every feature page, shared components, and the data-access layer the UI relies on.

---

## 1. Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 18 (function components + hooks) |
| Language | TypeScript 5.8 |
| Build tool | Vite 5 (`@vitejs/plugin-react-swc`) |
| Styling | Tailwind CSS 3 + **"Aurora"** design tokens (HSL CSS vars): charcoal canvas, indigo→cyan gradient accents, glass + glow |
| UI primitives | shadcn/ui (Radix UI under the hood) — ~50 components in `src/components/ui` |
| Icons | lucide-react |
| Server state | TanStack React Query v5 w/ app-wide caching defaults (staleTime 5m, gcTime 30m, no refetch-on-focus); heavy use only in MediaTracker, most pages still manual `useState`+`useEffect` |
| Code-splitting | All authenticated routes are `React.lazy` (Suspense + `RouteFallback`); vite `manualChunks` groups vendors; route chunks prefetched on nav hover |
| Routing | react-router-dom v6 |
| Animation | framer-motion + hand-written CSS keyframes in `index.css` |
| Rich text | Tiptap v2 (StarterKit + Underline) for Notes |
| Code editor | CodeMirror 6 for Code Snippets |
| Forms/validation | react-hook-form + zod (libs present; most forms are manual `useState`) |
| HTML sanitization | DOMPurify (`sanitizeHtml`, `sanitizePreview` in `lib/utils.ts`) |
| Dates | date-fns + custom IST-safe helpers in `lib/date-utils.ts` |
| PWA | vite-plugin-pwa (autoUpdate, Workbox runtime caching) |
| Charts | recharts (only via `ui/chart.tsx`; not actively used by features) |
| Package manager | npm (`package-lock.json`) — standardized across all devices |

Path alias: `@/` → `src/`.

---

## 2. Application Entry & Providers

`src/main.tsx` → renders `<App/>` into `#root`.

`src/App.tsx` composes the provider tree (outer → inner):

```
QueryClientProvider          (caching defaults: staleTime 5m, gcTime 30m, no refetch-on-focus)
  └ AuthProvider              (src/hooks/useAuth.tsx)
     └ SidebarProvider        (src/contexts/SidebarContext.tsx)
        └ TooltipProvider
           ├ Toaster          (shadcn toast)
           ├ AuroraBackdrop   (ambient indigo/cyan orbs, fixed z-0)
           └ BrowserRouter
                ├ CommandPalette        (⌘K launcher)
                └ AppInner → Suspense(RouteFallback) → lazy Routes
```

`AppInner` also applies the saved theme on mount (reads `localStorage.theme` for light/dark and `app-theme` for the color theme, then calls `applyTheme`). All authenticated route components are `React.lazy`-imported (code-split); only auth/landing routes load eagerly.

> Note: only the shadcn `Toaster` (`use-toast`) is mounted; the previously-mounted Sonner toaster has been removed.

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

`/prompts` is a working alias that renders `Library` (same as `/library`); the old dead `src/pages/Prompts.tsx` has been removed.

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


- **Aurora redesign**: glass rail (`bg-sidebar/85 backdrop-blur-xl`), gradient brand mark, gradient active indicator + glow, a `⌘K` Search trigger. Hovering/focusing a nav link **prefetches that route's code chunk** via `lib/route-prefetch.ts` (instant navigation).

### Page shell (`src/components/PageShell.tsx`)
Most content pages render through **`<PageShell title icon actions subtitle>`** — it supplies the sidebar, a glassy header with a gradient title, a transparent padded content region (so the ambient backdrop shows), the `lg:hidden` mobile hamburger, and an entrance transition. Bespoke full-height pages (Notes, MediaTracker, Calendar) keep their own layout with a transparent root instead of PageShell.

### Command palette (`src/components/CommandPalette.tsx`)
`⌘K` / `Ctrl+K` (or `window.dispatchEvent(new Event('open-command-palette'))`, e.g. the sidebar Search button) opens a cmdk launcher to jump to any screen or run quick actions.

---

## 6. Styling System — "Aurora" (`src/index.css` + `tailwind.config.ts` + `lib/themes.ts`)

- **Aesthetic**: premium-SaaS. Deep charcoal canvas, electric **indigo (`--primary`) → cyan (`--accent-2`) gradient** accents, glassy surfaces with soft glow, gradient headlines, crisp spring motion.
- **Design tokens**: HSL CSS variables on `:root` (light) and `.dark`. Tailwind colors map to `hsl(var(--token))`. Aurora adds `--accent-2`/`--accent-2-hover`, `--glow`, and gradient/glow vars (`--gradient-brand[-soft]`, `--glow-sm/md/lg`).
- **Fonts**: Inter for both `font-heading` and `font-body`.
- **Color themes**: 3 families in `lib/themes.ts` — `aurora` (default, dark-first), `netflix`, `prime` — each a full light+dark palette. `applyTheme(name, mode)` writes every token to `document.documentElement` inline styles (transitions briefly disabled to avoid flash). Persisted to `localStorage` `app-theme`; light/dark under `theme`. The static `:root`/`.dark` blocks in `index.css` are the Aurora first-paint fallback.
- **Signature utilities**: `.gradient-text`/`.gradient-text-soft` (headlines), `.bg-gradient-brand[-soft]`, `.zen-card` (workhorse card — lit border + glow hover), `.aurora-card` (gradient-bordered hero/stat tile), `.glass`/`.glass-strong` (modals/sidebar/floating), `.glow` + `shadow-glow*`, `.chip-tint`, hover-lift/scale, `.loading-shimmer`, `.animate-glow-pulse`/`.animate-float`, `.stagger-item`.
- **Ambient backdrop**: `<AuroraBackdrop/>` (rendered once in `App.tsx`) paints two drifting indigo/cyan orbs fixed behind the app at `z-0`; page roots are transparent so it glows through behind cards.
- **Motion**: shared framer-motion helpers in `components/ui/motion.tsx` — `PageTransition`, `Stagger`/`StaggerItem`, `FadeIn`.
- **Editor styles**: global `.ProseMirror` (Tiptap) and `#rich-editor`/`.note-preview` list styling.
- **Accessibility**: `prefers-reduced-motion` neutralizes animations (incl. the backdrop); focus-visible outlines defined globally.

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
- Summary cards: Monthly Cost, Yearly Cost, Active count, Renews Soon. List with status dots, renewal countdown, edit/delete.
- A DB trigger auto-creates a linked `ledger_entries` row (per `lib/subscriptions.ts` comments). Categories auto-seeded.
- ⚠️ No mobile hamburger header.

### Calendar (`pages/Calendar.tsx` + `components/calendar/*` + `hooks/useCalendar.ts`)
- Month/Week views. Events fetched via the `get_calendar_events` Postgres RPC (unified across tasks, birthdays, subscriptions, countdowns, media, notes), filtered client-side by `CalendarFilters`.
- `MonthView`: 7-col grid, weekend tinting, today highlight, up to 4 events/day + "+N more", HoverCard preview. `WeekView`, `CalendarHeader` (nav + filter legend), `DayDetailModal`, `QuickAddDialog`, `CalendarFilters`.
- ⚠️ No mobile hamburger header.

### Birthdays (`pages/Birthdays.tsx`)
- Sections: Upcoming (next 5), Recent (past 3), All (sorted by month/day). Cards show age + days-until with a pulse on the actual day.
- Add/Edit modal uses 3 cascading Selects (year → month → day). Search by name. Delete via `ConfirmDialog`. A single shared add/edit `<Dialog>` is opened by both the mobile and desktop header buttons (`openAddModal`).

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
| `AppSidebar` | Main navigation — Aurora glass rail, ⌘K trigger, hover route-prefetch (see §5) |
| `PageShell` | Shared page frame: sidebar + glassy gradient-title header + transparent content + entrance transition |
| `CommandPalette` | ⌘K / Ctrl+K launcher (cmdk) — jump to any screen / quick actions |
| `AuroraBackdrop` | Ambient drifting indigo/cyan orbs (rendered once in `App.tsx`) |
| `RouteFallback` | Suspense fallback shown while a lazy route chunk loads |
| `ui/motion` | Shared framer-motion helpers — `PageTransition`, `Stagger`/`StaggerItem`, `FadeIn` |
| `ProtectedRoute` | Auth gate |
| `ConfirmDialog` | Reusable destructive-action confirm (AlertDialog) |
| `CodeEditor` | CodeMirror 6 wrapper (lang extensions, one-dark in dark mode, read-only support) |
| `TagBadge` | Colored pill with contrast-aware text, optional remove |
| `CompactTagSelector` | Inline tag add/create dropdown (used by Notes/Tasks/Library forms) |
| `TagFilter` | Dropdown multi-select tag filter (AND semantics) |
| `TagCloud` | Usage-weighted tag cloud (used by Dashboard TagsWidget) |
| `dashboard/WidgetManager` | Customize dashboard modal |
| `dashboard/WidgetWrapper` | Widget chrome (title, size menu, loading skeleton) — note Dashboard renders widgets directly and does not use this wrapper's editing UI |
| `dashboard/CircularProgress` | Task-completion ring |
| `dashboard/widgets/*` | 12 widget components |
| `media/MediaCard` | Poster card w/ hover actions, lazy `useInView`, cover refresh |
| `media/CustomGroupBuilder` | Build/manage custom media type groups |
| `calendar/*` | Calendar views, header, modals, filters |
| `ui/*` | shadcn primitives (~50) |

### Tag-selection components
`CompactTagSelector` (inline add/create, used in forms) plus `TagFilter` and `TagCloud` are the wired-in tag components. (The earlier unused `TagInput` and `QuickTagButtons` have been removed.)

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
| `themes.ts` | 3 Aurora theme families (`aurora`/`netflix`/`prime`) + `applyTheme`/`getCurrentTheme`/`saveTheme` |
| `route-prefetch.ts` | Prefetch a route's lazy code chunk on nav hover (instant transitions) |
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
npm install
npm run dev        # Vite dev server (configured host "::", port 8080)
npm run build      # production build
npm run build:dev  # development-mode build
npm run lint       # eslint
npm run preview    # preview built app
```

Required env (Vite, `VITE_` prefixed are public/client): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID`. Optional: `TMDB_API_KEY`, `OMDB_API_KEY` (note these are read in client code via `import.meta.env` in `media-refresh.ts` but are not `VITE_`-prefixed, so they're effectively undefined at runtime — see audit).

PWA: service worker auto-update; caches Google Fonts (CacheFirst) and Supabase API (NetworkFirst, 5min).

Production build is **code-split**: every authenticated route is `React.lazy` and `vite.config.ts` `manualChunks` groups shared vendors, so heavy libraries (Tiptap, CodeMirror, recharts) download only when their page is opened — no single-bundle chunk-size warning. Nav links warm the next route's chunk on hover (`lib/route-prefetch.ts`).
