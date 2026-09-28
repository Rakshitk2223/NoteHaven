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
- react-router-dom 6; TanStack Query 5 (MediaTracker, Library, CommandsTab, RefreshActivityContext —
  most other pages use manual `useState` + `useEffect`).
- Tiptap 2 (Notes), CodeMirror 6 (snippets), recharts (ledger charts), cmdk (⌘K), date-fns, DOMPurify,
  jszip (vault downloads).
- supabase-js 2; vite-plugin-pwa (autoUpdate).
- **npm only** (`package-lock.json`; no bun/yarn/pnpm). Node 20 in `.nvmrc` and CI; `engines` requires
  Node ≥18 / npm ≥9, enforced by `.npmrc` `engine-strict=true`.

## Commands

```bash
npm install
npm run dev            # http://localhost:8080 (host "::")
npm run typecheck      # tsc --noEmit -p tsconfig.app.json
npm run build          # typecheck, then vite build → dist/
npm run lint           # eslint
npm run test:insights  # assertion script for lib/media-insights + lib/media-progress
npm run preview        # serve dist/
```

Maintenance scripts (`backfill:*`, `backup:media`, `audit:coverage`, `smoke:apis`) are described in `README.md`.

**Done means** `npm run build`, `npm run lint` (zero errors) and `npm run test:insights` all pass —
what CI runs (`.github/workflows/ci.yml`, GitHub Actions, on push to `main` and on PRs), plus an esbuild
parse of the edge function.
- The existing lint warnings are known: `react-hooks/exhaustive-deps` on deliberate mount-only effects
  and `react-refresh/only-export-components`. Don't add new ones, and don't "fix" a mount-only effect by
  adding deps (that's how refetch loops happen).
- Bare `tsc --noEmit` is a **false green**: root `tsconfig.json` has `files: []`. Use `npm run typecheck`.
  `tsconfig.app.json` is loose (`strict: false`).
- There is no test framework. The test script is plain `tsx` with hand-rolled asserts. Vitest for the
  `lib/*` data layer is the one open backlog item; set it up explicitly if you add it.

## Environment

| Where | Variables | Notes |
|---|---|---|
| `.env` — client (copy `.env.example`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public by design; Vite inlines them at build time. `VITE_SUPABASE_PROJECT_ID` is in the template but no code reads it |
| `.env` — local scripts only | `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY` | the service-role key bypasses RLS: **never import it into `src/`**. OMDB is used only by `backfill:covers` |
| edge-function secrets (`supabase secrets set`) | `TMDB_API_KEY`, `FANART_API_KEY` (optional), `ALLOWED_ORIGINS` (CORS; unset means `*`) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase runtime |

## Layout

```
src/
  App.tsx                 providers + route table (auth pages eager, everything else React.lazy)
  index.css               Aurora tokens, utilities, animations
  pages/                  one file per route; pages/settings/ holds the Settings sections
  components/             app-level pieces (AppSidebar, PageShell, CommandPalette, Tag*, ConfirmDialog, CodeEditor…)
    ui/                   shadcn primitives + DatePicker, empty-state, filter-pill, motion
    calendar/ dashboard/ ledger/ library/ media/ recipes/ settings/ vault/ work/   feature components
  hooks/, contexts/       auth, preferences, calendar, sidebar, refresh activity, toast…
  lib/                    data access (one module per feature) + pure helpers
  integrations/supabase/  client.ts (the only client) + types.ts
supabase/                 config.toml, functions/media-search/, migrations/
scripts/                  tsx maintenance scripts; __tests__/ holds the insights test
deploy-edge-function.sh   links the project, deploys media-search, sets its secrets
```

## Database and migrations

- The schema is `supabase/migrations/*.sql`, applied **by hand in the Supabase SQL editor**, in filename
  order: `00_baseline_schema` (the former 01–19, consolidated 2026-08-14), `20_data_cleanup`,
  `21_commands`, `22_security_lint`, `22_wishlist`, `23_work_projects`. There is no migration runner;
  don't use `supabase db push` (two files share the `22_` prefix). **Next new file: `24_*.sql`.**
- All six are live on production (confirmed by the owner, 2026-08-20).
- **Re-run safety:** `21`, `22_security_lint`, `22_wishlist` and `23` are idempotent. **Don't re-run
  `00` or `20`**: `00` fails with "policy already exists", and `20`'s orphan-tag cleanup predates
  `work_project_tags`, so it would delete tags used only by work projects.
- **Known limitation:** `00` can't currently bootstrap an empty project, and no SQL adds `notes` to the
  realtime publication (see `docs/BACKLOG.md`).
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
- **Adding a user table** means adding it to the backup list in `settings/DataSection.tsx`
  (`EXPORT_TABLES`, plus its FK remaps).
- **Pure modules** (`media-insights`, `media-progress`, `secret-mask`, `recipe-parse`, `pantry-match`)
  must not import the Supabase client — it pulls in `import.meta.env` and breaks the `tsx` test.
- **localStorage** holds UI preferences; guard every access in try/catch. Key list: `context/frontend.md`.
- **Big pages** (MediaTracker, Library, Notes) mix fetching, state and JSX: extract when making
  substantial changes, but keep diffs scoped.

## By design — don't "fix" these

1. **Note sharing goes through RPCs.** `SharedNote.tsx` calls `get_shared_note(p_share_id)` /
   `update_shared_note(...)` (SECURITY DEFINER; the share UUID is the credential, so anon may call
   them). `shared_notes` is owner-only and recipients can't read `notes`. Don't turn it back into a table query.
2. **The edge function verifies JWTs** (`verify_jwt = true` in `supabase/config.toml`; the setting is
   sticky server-side, which is why it lives there) and rejects any role but `authenticated`. Call it
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
    1000-row cap. **Restore is known-broken** for ledger entries, subscriptions and categories (see
    `docs/BACKLOG.md`); Vault and `user_preferences` are deliberately never restored.

## Decided — don't re-litigate

- **2026-08-20 backlog triage:** every proposal was declined except Vitest smoke tests for `lib/*`. The
  declined list is in `docs/BACKLOG.md` — don't re-propose those items.
- **2026-08-20 TMDB key:** `381f2d0e…`, committed in `aea34a8`, stays readable in git history. The owner
  chose not to rotate it (worst case: someone burns free-tier TMDB quota). `deploy-edge-function.sh`
  reads `TMDB_API_KEY` from the environment, and `ALLOWED_ORIGINS` is set on the deployed function.
- **2026-08 security hardening** (share-link policies, unchecked `p_user_id` in the definer RPCs) was
  confirmed closed on production on 2026-08-14. `docs/audit/AUDIT_ONE_SHOT.sql` re-checks the live
  database as one statement (the SQL editor shows only the last result set). **Caveat: its section 13
  still queries the dropped `ledger_buckets`, so the whole query fails until that section is removed.**

## Docs

- `README.md` — setup, run, deploy, maintenance scripts, troubleshooting.
- `context/frontend.md` — routes → pages → lib → tables, components, hooks, theming, storage keys, build.
- `context/backend.md` — tables, RPCs, triggers, Storage, realtime, edge function, migrations, scripts.
- `docs/BACKLOG.md` — open items, known limitations, declined ideas.
