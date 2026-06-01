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
  index.css               # design tokens + global styles + animations
  pages/                  # one file per route (some are 1000–1900 lines)
  components/
    ui/                   # shadcn primitives (~50)
    dashboard/widgets/    # 12 dashboard widgets
    calendar/             # calendar views/modals
    media/                # MediaCard, CustomGroupBuilder
    Tag*.tsx              # tag UI components
  contexts/SidebarContext.tsx
  hooks/                  # useAuth, useCalendar, use-mobile, use-media-query, use-toast
  lib/                    # data-access + utilities (talk to Supabase here)
  integrations/supabase/  # client.ts + generated types.ts
scripts/backfill-cover-images.ts
deploy-edge-function.sh
context/                  # frontend.md, backend.md (architecture docs)
```

The `supabase/` folder is git-tracked and present: `config.toml`, the `media-search` edge function, and five SQL migrations (`migrations/01`→`05`). These plus `src/integrations/supabase/types.ts` are the schema source of truth. (`supabase/.temp/` is CLI cache — untracked.)

---

## Architecture conventions

- **Data access**: prefer the `lib/*` modules. Many pages also call `supabase.from(...)` inline — match the local pattern of the file you're editing.
- **Auth gating**: wrap protected routes in `<ProtectedRoute>`; get the user from `useAuth()`.
- **Server state**: MediaTracker uses React Query (`useInfiniteQuery`, optimistic cache updates). Most other pages use manual `useState` + `useEffect` + `Promise.all`. Keep consistency within a page.
- **Dates**: use `lib/date-utils.ts` (`dateToYMD`, `parseYMD`) to avoid UTC drift. Avoid `new Date(isoString)` / `toISOString().split('T')[0]` for local dates.
- **Toasts**: use `useToast()` from `@/components/ui/use-toast` (the Sonner instance is mounted but unused by features).
- **HTML content**: sanitize with `sanitizeHtml`/`sanitizePreview` (`lib/utils.ts`) before rendering stored note HTML.
- **Styling**: use design tokens (`bg-background`, `text-foreground`, `border-border`, `text-primary`, etc.) and the `.zen-*` utility classes. Don't hard-code raw colors when a token exists. Themes are applied by writing CSS vars in `lib/themes.ts`.
- **Tags**: tag IDs that are negative are unsaved/temporary; persist via `createTag` then the entity-specific `set<Entity>Tags` helpers.
- **localStorage** is used widely for UI prefs (see frontend.md §11). Guard access in try/catch (existing code does).

---

## Things to be careful about (known rough edges)

These are documented more fully in the audit / context files. Be aware when touching related code:

1. **Dashboard ledger widget is broken** — `Dashboard.tsx → fetchLedgerSummary` filters `ledger_entries` on a non-existent `date` column (should be `transaction_date`); the error is swallowed. Use `lib/ledger.ts` helpers instead of re-querying.
2. **`/prompts` and `/library` both render `Library`**; `pages/Prompts.tsx` is dead/unreachable.
3. **No mobile sidebar access** on `MoneyLedger`, `Subscriptions`, and `Calendar` (they lack the `lg:hidden` hamburger header other pages have).
4. **Dead components**: `TagInput.tsx`, `QuickTagButtons.tsx`, and the `iconMap` const in `AppSidebar.tsx` are unused. Three tag selectors overlap — only `CompactTagSelector`/`TagFilter`/`TagCloud` are wired in.
5. **Two toast systems** mounted (`Toaster` + `Sonner`); features only use `use-toast`.
6. **Duplicated UI**: the Birthdays add/edit Dialog is copy-pasted in both mobile and desktop headers; Subscriptions has a 4th summary card that duplicates "Monthly Cost".
7. **Browser TMDB/OMDB calls** in `media-refresh.ts` read non-`VITE_` env vars → undefined in the browser; those branches silently no-op.
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
