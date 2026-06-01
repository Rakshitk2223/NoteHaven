# NoteHaven — Audit & Fix Log

This document tracks issues found during the frontend/codebase audit, ordered roughly by severity. Check items off as they're fixed.

Legend: 🔴 bug/security · 🟠 UX/responsive · 🟡 cleanup/dead code · 🔵 consistency/maintainability

---

## 🔴 Functional bugs

### 1. Dashboard ledger widget silently shows nothing (wrong column)
- **File:** `src/pages/Dashboard.tsx` → `fetchLedgerSummary`
- **Problem:** Queries `ledger_entries` filtering on `.gte('date', …)` / `.lte('date', …)`. The real column is `transaction_date` (see `types.ts`, `lib/ledger.ts`). The query throws and the error is swallowed by try/catch, so the ledger summary is always empty.
- **Fix:** Use `transaction_date`, or call `getLedgerSummary` / `fetchLedgerEntries` from `lib/ledger.ts` instead of an inline query.
- **Status:** [ ] open

### 2. Public shared notes render unsanitized HTML (XSS)
- **File:** `src/pages/SharedNote.tsx`
- **Problem:** Sets `titleRef.current.innerHTML = noteData.title` and content via `innerHTML` directly, with `contentEditable`, no DOMPurify. This is a public, unauthenticated route — a crafted shared note can execute script in a viewer's browser.
- **Fix:** Run stored title/content through `sanitizePreview` (`lib/utils.ts`) before injecting.
- **Status:** [ ] open

### 3. Browser-side TMDB/OMDB cover refresh can never work
- **File:** `src/lib/media-refresh.ts`
- **Problem:** Reads `import.meta.env.TMDB_API_KEY` / `OMDB_API_KEY`, which aren't `VITE_`-prefixed → always `undefined` in the browser. Those branches silently no-op.
- **Fix:** Route TMDB/OMDB through the edge function (like MangaUpdates already is), or document that they only work server-side.
- **Status:** [ ] open

### 4. Duplicate / conflicting PWA service workers
- **Files:** `public/service-worker.js`, `public/pwa-register.js`, `index.html`, `vite.config.ts`
- **Problem:** A manual service worker (`public/service-worker.js`, registered by `pwa-register.js` in `index.html`) runs **alongside** the `vite-plugin-pwa` (Workbox) service worker configured in `vite.config.ts`. Two competing SWs with different caching strategies → unpredictable caching, stale assets, and update issues.
- **Fix:** Removed the manual SW + register script and now rely solely on `vite-plugin-pwa` (its `registerType: 'autoUpdate'` auto-injects registration). Deleted `public/service-worker.js`, `public/pwa-register.js`, and the `<script src="/pwa-register.js">` line in `index.html`.
- **Status:** [x] DONE

---

## 🟠 UX / responsive design

### 5. No way to open the sidebar on mobile (3 pages)
- **Files:** `src/pages/MoneyLedger.tsx`, `src/pages/Subscriptions.tsx`, `src/pages/Calendar.tsx`
- **Problem:** These lack the `lg:hidden` hamburger header that every other page has. On mobile the sidebar defaults to collapsed/off-canvas, so there's no in-page control to open navigation.
- **Fix:** Add the standard mobile header bar with the `Menu` button → `toggleSidebar`.
- **Status:** [ ] open

### 6. Conflicting Tailwind display classes in Dashboard header
- **File:** `src/pages/Dashboard.tsx`
- **Problem:** `className="flex items-center gap-3 hidden md:flex"` — both `flex` and `hidden` set `display`. Intent is "hidden on mobile, flex on md+".
- **Fix:** `hidden md:flex items-center gap-3`.
- **Status:** [ ] open

### 7. Inconsistent / tight mobile padding
- **Files:** `src/pages/MoneyLedger.tsx`, `src/pages/Subscriptions.tsx`
- **Problem:** Use `p-6` directly while other pages use `p-4 sm:p-6` (tight on small screens).
- **Fix:** Standardize on `p-4 sm:p-6`.
- **Status:** [ ] open

### 8. Ad-hoc mobile detection instead of shared hook
- **File:** `src/pages/Notes.tsx` (and a few others)
- **Problem:** Implements its own `window.innerWidth < 768` + resize listener while `hooks/use-mobile.tsx` (`useIsMobile`) already exists.
- **Fix:** Use `useIsMobile()` for consistent breakpoints and fewer listeners.
- **Status:** [ ] open

### 9. Login background blobs invisible/muddy in dark mode
- **File:** `src/pages/Login.tsx`
- **Problem:** `FloatingShapes` uses `mix-blend-multiply`, which only reads well on light backgrounds.
- **Fix:** Use `mix-blend-screen` in dark mode or gate the effect by theme.
- **Status:** [ ] open

### 10. `user-scalable=no` disables pinch-zoom (accessibility)
- **File:** `index.html`
- **Problem:** Viewport meta blocks zoom (WCAG 1.4.4 regression).
- **Fix:** Remove `user-scalable=no` (and `maximum-scale` if present).
- **Status:** [ ] open

---

## 🟡 Dead code / useless features

### 11. Unreachable page: `Prompts.tsx`
- **Files:** `src/pages/Prompts.tsx`, `src/App.tsx`
- **Problem:** Imported in `App.tsx` but never rendered — both `/prompts` and `/library` render `Library`. Superseded by Library's Prompts tab.
- **Fix:** Deleted `Prompts.tsx` and removed its import from `App.tsx`.
- **Status:** [x] DONE

### 12. Unused components: `TagInput.tsx`, `QuickTagButtons.tsx`
- **Files:** `src/components/TagInput.tsx`, `src/components/QuickTagButtons.tsx`
- **Problem:** Never imported anywhere. Overlap with the in-use `CompactTagSelector`.
- **Fix:** Deleted both.
- **Status:** [x] DONE

### 13. Dead constant `iconMap`
- **File:** `src/components/AppSidebar.tsx`
- **Problem:** `iconMap` is declared but never read (each nav item carries its own `icon`).
- **Fix:** Remove the constant.
- **Status:** [ ] open

### 14. Two toast systems mounted
- **File:** `src/App.tsx`
- **Problem:** Both `<Toaster/>` (shadcn) and `<Sonner/>` are mounted; features only use `use-toast`.
- **Fix:** Remove `<Sonner/>` (and the dependency if nothing else needs it).
- **Status:** [ ] open

### 15. Duplicated modal markup
- **Files:** `src/pages/Birthdays.tsx`, `src/pages/MoneyLedger.tsx`
- **Problem:** Birthdays copy-pastes the entire add/edit Dialog into both mobile and desktop headers. MoneyLedger mounts near-identical Add and Edit dialogs inline.
- **Fix:** Extract a single reusable dialog component per page.
- **Status:** [ ] open

### 16. Subscriptions has a duplicate summary card
- **File:** `src/pages/Subscriptions.tsx`
- **Problem:** "Monthly Cost" and "Total Monthly" both render `summary.monthlyTotal`.
- **Fix:** Remove one or show something distinct (e.g., upcoming-renewals count).
- **Status:** [ ] open

### 17. `WidgetWrapper` editing UI is orphaned
- **File:** `src/components/dashboard/WidgetWrapper.tsx`
- **Problem:** Implements an `isEditing` mode (drag handle + size menu) never used — Dashboard renders widgets directly and sizes/reorders via `WidgetManager`.
- **Fix:** Route widgets through it or trim the unused branch.
- **Status:** [ ] open

### 18. `cleanupEmptyTags` is an empty placeholder
- **File:** `src/lib/tags.ts`
- **Problem:** Exported as if functional but does nothing.
- **Fix:** Remove or implement (a `cleanup_empty_tags` RPC exists).
- **Status:** [ ] open

### 19. Notes "pagination" is misleading
- **File:** `src/pages/Notes.tsx`
- **Problem:** `notesPerPage = 50` + controls exist, but `fetchNotes` loads all notes (no range/limit). Purely client-side slicing — not a real perf feature.
- **Fix:** Either implement server-side ranged fetch or drop the pagination framing.
- **Status:** [ ] open

---

## 🔵 Consistency / maintainability

### 20. Theme system has two sources of truth
- **Files:** `src/index.css`, `src/lib/themes.ts`
- **Problem:** `index.css` hard-codes the zen-garden palette into `:root`/`.dark`; `lib/themes.ts` writes the active theme's vars inline. First paint can flash the default before the saved theme applies.
- **Fix:** Initialize theme vars before React mounts (inline script in `index.html`) or generate the static block from the theme config.
- **Status:** [ ] open

### 21. Realtime note sync is intricate/fragile
- **File:** `src/pages/Notes.tsx`
- **Problem:** Multiple refs (`hasLocalChangesRef`, `localEditTimestampRef`, `lastLoadedNoteIdRef`), debounced per-field saves, and a per-save conflict re-read. Hard to reason about; likely source of subtle "edit reverted" bugs.
- **Fix:** Extract into a dedicated hook with clear conflict semantics.
- **Status:** [ ] open

### 22. Repeated `supabase.auth.getUser()` calls
- **File:** `src/pages/Dashboard.tsx` (and others)
- **Problem:** Calls `getUser()` inside nearly every fetch helper instead of reading from `useAuth()`. Extra latency and redundant awaits.
- **Fix:** Use the context user.
- **Status:** [ ] open

### 23. Inconsistent server-state strategy
- **Files:** all pages
- **Problem:** MediaTracker uses React Query (caching, optimistic updates); other pages use manual `useState`/`Promise.all` with duplicated loading/error patterns and manual refetch.
- **Fix:** Migrate list pages to React Query to remove boilerplate (larger refactor).
- **Status:** [ ] open

### 24. Stale `renewals` in Dashboard calendar events
- **File:** `src/pages/Dashboard.tsx`
- **Problem:** `generateCalendarEvents()` uses the `renewals` state from the previous render rather than the freshly fetched value, so subscription events on the mini-calendar lag one render behind. (Also flagged in the earlier `.opencode` plan doc.)
- **Fix:** Pass the freshly fetched renewals directly into `generateCalendarEvents`.
- **Status:** [ ] open

### 25. `WidgetManager` could show stale data
- **File:** `src/components/dashboard/WidgetManager.tsx`
- **Note:** `localWidgets` IS synced via `useEffect` on the `widgets` prop (the earlier plan doc flagged this as missing, but it's present). Verify it stays correct if the manager is reworked.
- **Status:** [ ] verify

---

## 🔴 Security / ops

### 26. Hard-coded `TMDB_API_KEY` committed to VCS
- **File:** `deploy-edge-function.sh`
- **Problem:** A live API key literal is checked into the repo.
- **Fix:** Rotate the key, remove the literal, and read it from env/secrets at deploy time.
- **Status:** [ ] open

### 27. `manifest.json` references a missing screenshot
- **File:** `public/manifest.json`
- **Problem:** Lists `/screenshot-mobile.png`, which doesn't exist in `public/`.
- **Fix:** Removed the `screenshots` entry from the manifest.
- **Status:** [x] DONE

---

## Repo cleanup (tracked files that shouldn't be)

- `supabase/.temp/*` — Supabase CLI cache; was committed despite being in `.gitignore`. **DONE:** untracked via `git rm -r --cached supabase/.temp` (kept on disk for the CLI).
- `.opencode/*` — another AI tool's workspace (package-lock + an old migration plan doc); was committed despite being in `.gitignore`. **DONE:** untracked and deleted from disk.

> These removals are staged in git but **not committed** — commit when ready (e.g. `git commit -m "chore: cleanup dead code, dedupe PWA, untrack CLI cache"`).
