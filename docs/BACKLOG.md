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

- 🔲 **Vitest smoke tests for the `lib/*` data layer.** The only test today is `npm run test:insights`,
  which covers pure media helpers. The data modules have none, and past drift (RLS policies, type errors)
  was caught only by manual audits. There's no runner yet — set one up explicitly.
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

## Known limitations

- **The baseline can't build an empty project.** Section 15 of `00_baseline_schema.sql` reads
  `subscriptions.ledger_entry_id` before section 18 adds the column, so a fresh run aborts and rolls back.
- **`00` and `20` aren't safe to re-run.** `00` fails on existing policies; `20`'s orphan-tag cleanup
  would delete tags used only by work projects.
- **No SQL enables realtime on `notes`.** A new project needs it switched on in the dashboard.
- **JSON restore is broken** (Settings → Data) for ledger entries (`to_account_id` isn't remapped),
  subscriptions (`category_id` isn't remapped) and categories (they collide with the signup-seeded
  defaults). The export itself is complete.
- **`npm run backfill:metadata` gets 401s.** It calls the edge function without a user token.
- **`docs/audit/AUDIT_ONE_SHOT.sql` fails as a whole**: its section 13 queries the dropped
  `ledger_buckets`. Its tag checks also ignore `work_project_tags`.
