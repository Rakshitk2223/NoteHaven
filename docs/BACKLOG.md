# NoteHaven — open items

Kept as small as the truth allows: what's open, what's known to be broken, and what was deliberately
declined. Finished work lives in git history, not here.

## Declined — don't re-propose (owner triage, 2026-08-20)

Every proposal in the old backlog was reviewed and dropped except the Vitest item below. That covers
the dashboard drag-resize grid and presets, prompt versioning and sharing, media recommendations and
notifications, Tiptap upgrades, Kanban, calendar export, ledger budgets / recurring transactions /
receipts, subscription and birthday reminders, tag nesting, PWA push, full-text search, task priorities
and bulk actions, and reconciling the two theming paths (`index.css` static tokens vs `lib/themes.ts`).
They were declined on purpose, not forgotten; the full list is in this file's git history. Small fixes
and polish to existing features are always in scope.

## Open

- ✅ **Vitest for `lib/*`: runner in place** (Media v2 branch, 2026-09-28). `npm test` runs
  `src/**/*.test.ts` and `supabase/functions/**/*.test.ts` (`vitest.config.ts`, node environment); CI
  runs it (164 tests on 2026-09-29). It covers the Media v2 logic (matching, progress and its one
  writer, linking, the bulk journal, the Tachimanga parser and planner, the import UI's pure parts),
  export / restore, and the edge adult filter. The older data modules (ledger, tags, …) still have no
  tests: add them as they're touched. `npm run test:insights` stays as the `tsx` script.
- 🔲 **Extract Notes autosave** (`src/pages/Notes.tsx`, deferred on purpose). Saving is spread across
  refs (`hasLocalChangesRef`, `lastSavedUpdatedAtRef`, `lastLoadedNoteIdRef`, pending title/content
  refs), per-field debounced saves and realtime echo suppression — a likely home for subtle "my edit
  reverted" bugs. Move it into a `useNoteAutosave` hook with clear conflict semantics and tests.
- 🔲 **One server-state strategy** (deferred on purpose). MediaTracker, Library and the Commands tab use
  React Query; the other pages use hand-rolled `useState` / `useEffect` loading. Migrate list pages
  incrementally for instant cached back-navigation.
- 🔲 **Work "People" tab.** A disabled "People — later" tab is already visible on `/work`; it isn't built.
  Intended as a rollup of `work_projects.helped` (an `unnest` + `GROUP BY`).
- 🔲 **Two dashboard-only security steps** (from the footer of `22_security_lint.sql`; SQL can't do
  them): turn on leaked-password protection (Authentication → Sign In / Providers → Passwords) and apply
  the pending Postgres security patch (Settings → Infrastructure). Not confirmed done.

## Shipped: Media v2 (2026-09-29)

`media-v2` is on `main` and live: the web app via Netlify, the v2 edge function (`search`, `detail`,
`cover_copy`) redeployed, migrations 28–30 applied. Design and unit status are in `docs/media-v2/PLAN.md`.
It covers Phase 1 plus U0–U5 and E2: link by search-and-pick, fast logging and History, Dropped / On Hold,
the Tachimanga import with journaled Undo, Link your library, the Updates tab, one cover judge and
writer, and copying approved covers into NoteHaven storage. It also brought the installed app's
auto-update.

- 🔲 **Phone pass** (Rakshit): the final by-hand check on the iPhone, installed as a PWA.
- Push notifications and recommendations stay declined.

## Parked (not on the roadmap; revisit after U5)

Media v2 scope is frozen at U0–U5 (owner, 2026-09-29). These are wanted, just not now:

- **⌘K navigation skips the dirty-edit guard.** Leaving Media through the palette with unsaved edits doesn't ask first.
- **A client-side negative cache for no-match cover lookups**, so titles with no cover stop re-asking the edge function. (Probably moot since U5: the display no longer searches for covers.)
- **Mac `+` / `-` / `=` keys in the Log popover** (from `PLAN.md`'s Mac Log row).
- **Hands-free sync through AniList tracking.** Needs AniList OAuth.
- **Accept Tachimanga's lighter Tachiyomi-compatible `.tachibk` backup as an import format**, next to `.tmb` (U2b).
- **U6 polish:** hold-to-repeat, the season picker, "Caught up", Mac hover +1.
- **Cross-source duplicate detection through `alt_ids`**: spot two of his titles that are the same work
  linked on different sources (for example AniList vs MangaUpdates). Today the link queue only catches
  the same `source` + `source_id` twice.

## Known limitations

- **`00` and `20` aren't safe to re-run.** `00` fails on existing policies (and, if forced, would
  re-create `ledger_buckets`); `20`'s orphan-tag cleanup would delete tags used only by work projects.
- **JSON restore** (Settings → Data, `lib/restore.ts`) inserts new rows and remaps foreign keys; it never
  updates or deletes. Vault rows and `user_preferences` are deliberately never restored, and duplicates
  are possible when restoring into an account that already holds the same items.
