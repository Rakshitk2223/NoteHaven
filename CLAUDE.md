# CLAUDE.md

Guidance for AI assistants (and humans) working in the NoteHaven codebase. For deep detail see `context/frontend.md` and `context/backend.md`.

---

## What this project is

NoteHaven is a personal productivity & media companion: a React 18 + TypeScript + Vite single-page app backed entirely by Supabase (PostgreSQL + RLS, Auth, Realtime, RPC, one Edge Function). There is **no custom server** — the client talks to Supabase directly.

Features: Notes (rich text, auto-save, sharing), Tasks, AI Prompt library, Code Snippets, Media Tracker (anime/manga/movies/series with auto cover images), Money Ledger, Subscriptions, Birthdays, Countdowns, a unified Calendar, a cross-cutting Tags system, and a customizable widget Dashboard.

---

## Tech stack (quick reference)

- React 18, TypeScript 5.8, Vite 5
- Package manager: **npm** (standardized; lockfile is `package-lock.json`)
- Node 18+ (LTS recommended; pinned in `.nvmrc`)
- Tailwind CSS 3 + shadcn/ui (Radix) + lucide-react icons
- react-router-dom v6, TanStack React Query v5 (mainly MediaTracker)
- Tiptap (Notes rich text), CodeMirror 6 (snippets)
- framer-motion, date-fns, DOMPurify, recharts
- Supabase JS client; Supabase Edge Function (Deno) for media search
- PWA via vite-plugin-pwa

Path alias: `@/` → `src/`.

---

## Commands

This project standardizes on **npm**. Do not use bun/yarn/pnpm (they create conflicting lockfiles; only `package-lock.json` is committed).

```bash
npm install
npm run dev          # dev server (host "::", port 8080)
npm run build        # production build  ← run after changes to verify
npm run build:dev    # dev-mode build
npm run lint         # eslint
npm run preview      # preview build
npm run backfill:covers   # one-off: backfill media cover images (needs SUPABASE_SERVICE_ROLE_KEY)
```

If you use nvm/fnm, run `nvm use` to match `.nvmrc`. Node 18+ / npm 9+ is enforced via `package.json` "engines" + `.npmrc` (`engine-strict=true`).

There is **no test setup** in this repo. Do not assume a test runner exists; if adding tests, set one up explicitly and mention it.

Env vars (`.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID` (public client). `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY` are for scripts/edge function only — never import service-role into client code.

---

## Project structure

```
src/
  App.tsx                 # providers + routes
  main.tsx                # entry
  index.css               # Aurora design tokens + utilities + animations
  pages/                  # one file per route (some are 1000–1900 lines)
  components/
    ui/                   # shadcn primitives (~50) + motion.tsx (shared motion), command.tsx
    dashboard/widgets/    # 12 dashboard widgets
    calendar/             # calendar views/modals
    media/                # MediaCard, CustomGroupBuilder
    PageShell.tsx         # shared page frame (sidebar + gradient header + transition)
    AppSidebar.tsx        # Aurora glass rail (⌘K trigger, hover route-prefetch)
    CommandPalette.tsx    # ⌘K launcher  · AuroraBackdrop.tsx · RouteFallback.tsx
    Tag*.tsx              # tag UI components
  contexts/SidebarContext.tsx
  hooks/                  # useAuth, useCalendar, use-mobile, use-media-query, use-toast
  lib/                    # data-access + utilities (talk to Supabase here)
  integrations/supabase/  # client.ts + generated types.ts
scripts/backfill-cover-images.ts
deploy-edge-function.sh
context/                  # frontend.md, backend.md (architecture docs)
```

The `supabase/` folder is git-tracked and present: `config.toml`, the `media-search` edge function, and seven SQL migrations (`migrations/01`→`07`; `06` adds `ledger_buckets` + `bucket_id`/`from_bucket_id`/`transfer` for envelope budgeting; `07` adds `snippet_folders` + `folder_id`/`filename`/`description` on `code_snippets` so snippets organise into project folders). These plus `src/integrations/supabase/types.ts` are the schema source of truth. (`supabase/.temp/` is CLI cache — untracked.)

---

## Architecture conventions

- **Data access**: prefer the `lib/*` modules. Many pages also call `supabase.from(...)` inline — match the local pattern of the file you're editing.
- **Auth gating**: wrap protected routes in `<ProtectedRoute>`; get the user from `useAuth()`.
- **Server state**: MediaTracker uses React Query (`useInfiniteQuery`, optimistic cache updates). Most other pages use manual `useState` + `useEffect` + `Promise.all`. Keep consistency within a page. The app-wide `QueryClient` (in `App.tsx`) now has caching defaults: `staleTime` 5m, `gcTime` 30m, `refetchOnWindowFocus: false`. (Migrating high-traffic pages to React Query for instant cross-navigation caching is a worthwhile follow-up.)
- **Dates**: use `lib/date-utils.ts` (`dateToYMD`, `parseYMD`) to avoid UTC drift. Avoid `new Date(isoString)` / `toISOString().split('T')[0]` for local dates.
- **Toasts**: use `useToast()` from `@/components/ui/use-toast` (the Sonner instance is mounted but unused by features).
- **HTML content**: sanitize with `sanitizeHtml`/`sanitizePreview` (`lib/utils.ts`) before rendering stored note HTML.
- **Styling**: use design tokens (`bg-background`, `text-foreground`, `border-border`, `text-primary`, `text-accent-2`, `text-success`, `text-warning`, etc.) and the utility classes in `index.css`. Don't hard-code raw colors when a token exists. Themes are applied by writing CSS vars in `lib/themes.ts`.
- **Design system = "Aurora"** (premium-SaaS): deep charcoal canvas, electric **indigo (`--primary`) → cyan (`--accent-2`) gradient** accents, glassy surfaces with soft glow. Default theme is `aurora` (dark-first); `netflix` + `prime` remain selectable in Settings. Key utilities in `src/index.css`: `.gradient-text` / `.gradient-text-soft` (headlines), `.bg-gradient-brand[-soft]`, `.zen-card` (workhorse card — lit border + glow hover), `.aurora-card` (hero/stat tile w/ gradient border), `.glass` (modals/sidebar/floating), `.glow` + `shadow-glow*`, `.chip-tint`. The ambient drifting orbs come from `<AuroraBackdrop/>` (rendered once in `App.tsx`); **page roots must be transparent** (no `bg-background`) for them to show through.
- **Page shell**: most content pages render through `<PageShell title icon actions subtitle ...>` (`src/components/PageShell.tsx`) — it supplies the sidebar, a glassy gradient-title header, transparent padded content, and an entrance transition. Bespoke full-height pages (Notes, MediaTracker, Calendar) keep their own layout but use a transparent root. Don't reintroduce per-page sidebar/hamburger markup.
- **Motion**: use the shared helpers in `src/components/ui/motion.tsx` — `<PageTransition>`, `<Stagger>`+`<StaggerItem>`, `<FadeIn>` (one springy language). CSS classes `.animate-fade-in`, `.stagger-item`, `.hover-lift`, `.animate-glow-pulse`, `.animate-float` are also available.
- **Command palette**: `⌘K` / `Ctrl+K` opens `<CommandPalette/>` (cmdk; mounted in `App.tsx`). Open it programmatically with `window.dispatchEvent(new Event('open-command-palette'))`.
- **Buttons**: `<Button variant="gradient">` is the brand-gradient hero CTA (one per screen); `default` is solid indigo + glow.
- **Performance**: authenticated routes are `React.lazy` code-split in `App.tsx` (heavy libs — tiptap / codemirror / recharts — download only with their page); `vite.config.ts` `manualChunks` groups shared vendors (no more single 2.4 MB bundle / chunk-size warning). Nav links prefetch their route chunk on hover via `lib/route-prefetch.ts`. Skeletons use `.loading-shimmer`.
- **Tags**: tag IDs that are negative are unsaved/temporary; persist via `createTag` then the entity-specific `set<Entity>Tags` helpers.
- **localStorage** is used widely for UI prefs (see frontend.md §11). Guard access in try/catch (existing code does).

---

## Things to be careful about (known rough edges)

These are documented more fully in the audit / context files. Be aware when touching related code:

1. **Dashboard ledger widget** — now fixed: `fetchLedgerSummary` uses the RPC-backed `getLedgerSummary(year, month)` from `lib/ledger.ts` (previously an inline query with a `toISOString()` UTC-drift bug). Prefer the `lib/ledger.ts` helpers over re-querying `ledger_entries`.
2. **`/prompts` is a working alias** that renders `Library` (same as `/library`); the old dead `pages/Prompts.tsx` has been removed.
3. **Responsive/mobile**: `PageShell` renders the `lg:hidden` hamburger header for migrated content pages (bespoke full-height pages — Notes/MediaTracker/Calendar — keep their own). Mobile sizing is handled at the primitive level — `ui/dialog.tsx` (`w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto`, `p-4 sm:p-6`) and `ui/sheet.tsx` (`overflow-y-auto`, `p-4 sm:p-6`) are mobile-safe, so prefer those defaults over per-dialog width hacks. Use responsive padding (`p-4 sm:p-6`) and text (`text-2xl sm:text-3xl`) on new pages.
4. **Tag selectors**: `CompactTagSelector`/`TagFilter`/`TagCloud` are the wired-in components. (The old unused `TagInput.tsx`, `QuickTagButtons.tsx`, and `iconMap` in `AppSidebar.tsx` have been removed.)
5. **Toasts**: only the shadcn `Toaster` (`use-toast`) is mounted. (The unused Sonner toaster has been removed.)
6. *(resolved)* The Birthdays add/edit Dialog is now a single shared `<Dialog>` (both headers call `openAddModal`), and the duplicate Subscriptions summary card is gone (cards are Monthly Cost / Yearly Cost / Active / Renews Soon).
7. **Cover refresh** proxies key-protected sources (TMDB, Fanart.tv) through the `media-search` edge function via `?source=&refresh=1` (keys live server-side; browser env vars were undefined). Live-action fallback chain: TMDB/TVmaze → Wikidata/Commons (keyless) → Fanart.tv (optional `FANART_API_KEY`). OMDB removed (poster endpoint is patron-gated). Edge-function changes require redeploy.
8. **Secret in VCS**: `deploy-edge-function.sh` contains a hard-coded `TMDB_API_KEY` — rotate/remove; don't propagate it.
9. **Large page files** (Notes ~1300, MediaTracker ~1900 lines) mix data fetching, state, and JSX. Prefer extracting when making substantial changes, but keep diffs scoped.

---

## When making changes

- Read the file (and its `lib/*` data module) before editing; match existing patterns and the design-token styling.
- After edits, run `npm run build` (and `npm run lint`) to verify — there are no automated tests.
- Keep RLS in mind: every user table is scoped by `user_id = auth.uid()`. Client queries should filter by the authenticated user where the existing code does.
- Don't introduce a second Supabase client instance (auth/session relies on the single shared one).
- Be cautious with anything touching auth, RLS expectations, the edge function, or service-role usage — flag risky/destructive changes before applying.

---

## Key reference docs

- `context/frontend.md` — full frontend map (routing, pages, components, styling, state, data layer).
- `context/backend.md` — Supabase schema, RPCs, RLS, edge function, cover-image subsystem.
- `README.md` — setup, deployment, troubleshooting.
