# CLAUDE.md

Guidance for AI assistants (and humans) working in the NoteHaven codebase. For deep detail see `context/frontend.md` and `context/backend.md`.

---

## What this project is

NoteHaven is a personal productivity & media companion: a React 18 + TypeScript + Vite single-page app backed entirely by Supabase (PostgreSQL + RLS, Auth, Storage, Realtime, RPC, one Edge Function). There is **no custom server** — the client talks to Supabase directly.

Features: Notes (rich text, auto-save, share links), Tasks, AI Prompt library, Code Snippets, Media Tracker (anime/manga/movies/series with auto cover images), Money Ledger (accounts + cumulative "money in hand"), Subscriptions, Birthdays, Countdowns, a unified Calendar, a private file **Vault** (nested folders + files in Supabase Storage), a **Bucket List**, a **Recipes** cookbook, a cross-cutting Tags system, and a customizable widget Dashboard.

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

The `supabase/` folder is git-tracked: `config.toml`, the `media-search` edge function, and the SQL migrations. (`supabase/.temp/` is CLI cache — untracked.)

**Migrations were consolidated on 2026-08-14.** The former `01`→`19` files are now a single `00_baseline_schema.sql`, assembled verbatim in application order — every SQL line is byte-identical to the originals, which remain in git history. Running that one file top-to-bottom on a fresh Supabase project reproduces production. `20_data_cleanup.sql` follows it. New changes go in their own numbered file (`21_*.sql` next).

Migrations are applied **by hand in the Supabase SQL editor**, in filename order — there is no migration runner. `00` and `20` must be run explicitly on a new project. `00` is already live on the production database; `20` is not (see below).

`00_baseline_schema.sql` plus `src/integrations/supabase/types.ts` are the schema source of truth.

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

These are real, current, and worth knowing before you touch related code.

1. **The 2026-08 security drift is fixed and verified.** The live database had drifted in two dangerous ways: the share-link policies on `notes` had lost their share-id predicate (making any shared note world-readable), and `get_calendar_events` / `get_upcoming_renewals` were `SECURITY DEFINER` with an unchecked `p_user_id` (cross-tenant reads). Both are closed — confirmed against production on 2026-08-14: `notes` now carries only `auth.uid() = user_id` policies, and both RPCs check `auth.uid()`. Re-verify any time with `docs/audit/AUDIT_ONE_SHOT.sql` (one statement, 20 sections — the Supabase editor only renders the *last* result set, so multi-statement audit scripts silently discard everything above). Background: `docs/audit/audit-report.html`.
2. **Note sharing goes through RPCs, not tables.** `SharedNote.tsx` calls `get_shared_note(share_id)` / `update_shared_note(...)`. Recipients cannot read `shared_notes` or `notes` directly, by design — don't "simplify" it back to a table query.
3. **The edge function verifies JWTs.** Call it via `lib/edge-function.ts` (`mediaSearchGet`), which attaches the session token. A bare `fetch()` will 401.
4. **`media_metadata` is a shared, cross-tenant cache** with no `user_id`. Writes are limited to `authenticated`. Treat anything read from it as untrusted third-party data.
5. **`ledger_buckets` is retired.** The envelope-budgeting UI was removed long ago. `20_data_cleanup.sql` drops the table and the two `ledger_entries` columns; the code and `types.ts` no longer reference them. Confirmed safe first — zero entries referenced a bucket. **Run migration 20 before deploying**, or leave the dead table in place; do not half-apply.
6. **`/prompts` is a working alias** that renders `Library` (same as `/library`).
7. **Responsive/mobile**: `PageShell` renders the `lg:hidden` hamburger header for migrated content pages (bespoke full-height pages — Notes/MediaTracker/Calendar — keep their own). Mobile sizing is handled at the primitive level — `ui/dialog.tsx` and `ui/sheet.tsx` are mobile-safe, so prefer those defaults over per-dialog width hacks.
8. **Tag selectors**: `CompactTagSelector`/`TagFilter`/`TagCloud` are the wired-in components.
9. **Toasts**: only the shadcn `Toaster` (`use-toast`) is mounted.
10. **Rotate the TMDB key.** `381f2d0e…` was committed in `aea34a8` and is still readable in git history. `deploy-edge-function.sh` no longer contains it, but removing it from HEAD does not un-leak it.
11. **Use `getSession()`, not `getUser()`**, for "who am I" reads in the data layer — `getUser()` is a network round-trip per call.
12. **Large page files** (Notes ~1300, MediaTracker ~1900 lines) mix data fetching, state, and JSX. Prefer extracting when making substantial changes, but keep diffs scoped.

---

## When making changes

- Read the file (and its `lib/*` data module) before editing; match existing patterns and the design-token styling.
- After edits, run `npm run build` (which now typechecks first) and `npm run lint` to verify — there are no automated tests.
- `eslint` reports ~21 `react-hooks/exhaustive-deps` warnings on deliberate mount-only effects. Zero **errors** is the bar; don't add new ones.
- Keep RLS in mind: every user table is scoped by `user_id = auth.uid()`. Client queries should filter by the authenticated user where the existing code does.
- Don't introduce a second Supabase client instance (auth/session relies on the single shared one).
- Be cautious with anything touching auth, RLS expectations, the edge function, or service-role usage — flag risky/destructive changes before applying.

---

## Key reference docs

- `context/frontend.md` — full frontend map (routing, pages, components, styling, state, data layer).
- `context/backend.md` — Supabase schema, RPCs, RLS, edge function, cover-image subsystem.
- `README.md` — setup, deployment, troubleshooting.
- `docs/BACKLOG.md` — proposed enhancements per feature area.
- `docs/PENDING_FIXES.md` — known open items.
- `docs/audit/AUDIT_ONE_SHOT.sql` — single-statement live-database health check.
- `docs/archive/` — completed trackers and superseded dumps, kept for reference.
