# NoteHaven — Improvement Backlog

A running list of proposed enhancements and known-issue fixes, grouped by feature section.
Status legend: 🔲 planned · 🚧 in progress · ✅ done.

---

## 🏠 Dashboard
- ✅ **Ledger widget fixed** — `fetchLedgerSummary` now uses the RPC-backed `getLedgerSummary(year, month)` helper from `lib/ledger.ts` instead of an inline query, eliminating the `toISOString()` UTC-drift that mis-bounded the month in IST.
- 🔲 Income/expense sparkline + "spend vs. last month" delta on the ledger widget.
- 🔲 Drag-resize grid (react-grid-layout) instead of the 1/4–full size menu.
- 🔲 "Today" focus widget unifying tasks due, birthdays, renewals, countdowns.
- 🔲 Multiple dashboard presets ("Work" / "Personal"), keyed per-preset in `user_preferences`.
- 🔲 Global quick-add / command palette (⌘K).
- 🔲 Greeting + activity streak / tasks-completed-this-week ring.

## 📚 Library (Prompts + Snippets)
- ✅ Dead `pages/Prompts.tsx` already removed; `/prompts` is a working alias to Library.
- 🔲 Prompt variables / templating (`{{topic}}` fill-in dialog before copy).
- 🔲 Snippet run/preview for HTML/CSS/JS + "copy as markdown fenced block".
- 🔲 Full-text search across both tabs (pg_trgm already enabled).
- 🔲 Prompt versioning / edit history.
- 🔲 Shareable public prompt links (reuse `shared_notes` pattern).

## 🎬 Media Tracker
- ✅ **Cover refresh fixed** — TMDB/Fanart now proxy through the edge function (keys server-side via `?source=&refresh=1`). Added keyless **Wikidata/Commons** fallback for live-action; added **Fanart.tv** (optional `FANART_API_KEY`, no-ops until set). Removed OMDB (poster endpoint is patron-gated). _Requires edge-function redeploy to take effect._
- 🔲 Cover sources for anime/manga: anilist → kitsu → jikan → tvmaze → tmdb. Live-action: tmdb/tvmaze → wikidata → fanart.
- 🔲 Recommendations / "what's next" (next episode/chapter, airing schedule via AniList).
- 🔲 Ratings analytics (distribution chart, average by type, year-in-review).
- 🔲 Auto-status transitions (episode == total → prompt Complete).
- 🔲 New episode/chapter notifications (AniList airing schedule → calendar).
- 🔲 Collapse 8 media types into the custom-group system for a cleaner tab bar.

## 📝 Notes
- 🔲 Extract the ~1300-line page into editor/list/toolbar components.
- 🔲 Tiptap upgrades: slash commands, tables, task-lists, image upload, code blocks.
- 🔲 Backlinks / `[[note]]` linking.
- 🔲 Full-text search across note bodies.
- 🔲 Note → Task extraction from checkbox lines.
- 🔲 Verify `SharedNote` sanitizes stored HTML before `innerHTML` into contentEditable.

## ✅ Tasks
- 🔲 Subtasks / checklists and recurring tasks.
- 🔲 Priority levels + sort/filter by priority.
- 🔲 Reminders/notifications (PWA push) for due/overdue tasks.
- 🔲 Kanban / "Today · Upcoming · Someday" alternate view.
- 🔲 Bulk actions (complete/delete/tag multiple).

## 📅 Calendar
- ✅ Mobile hamburger header present (verified on Calendar, Ledger, Subscriptions — docs rough-edge #3 was stale).
- 🔲 Day/Agenda view + drag-to-reschedule tasks (`updateTaskDueDate` exists).
- 🔲 iCal / Google Calendar export of `get_calendar_events`.
- 🔲 Create events inline from `QuickAddDialog` writing back to the right entity.

## 💰 Money Ledger
- ✅ Mobile sidebar header present (verified).
- ✅ Charts added — spend-by-category pie (selected month) + monthly income/expense trend bars (selected year), in `components/ledger/LedgerCharts.tsx` using recharts. Theme-aware tooltips, responsive.
- ✅ **Buckets / envelope budgeting** — new `ledger_buckets` table + `bucket_id`/`from_bucket_id` on `ledger_entries` + `transfer` entry type (migration `06_add_ledger_buckets.sql`). Buckets have a kind (spending/saving/obligation/liability), color, optional goal. UI: `BucketsSection` (balances + goal progress + manage dialog), bucket allocation + transfers in `LedgerEntryForm`, transfers shown in the table. Data layer `lib/buckets.ts`. _Requires running migration 06._
- ✅ **Export UI** — CSV/JSON moved into a single "Export" dropdown menu (was two open buttons).
- 🔲 Auto-seed buckets (Personal/Stocks/Emergency/Credit Card/Mom) happens on first load — tune the defaults if desired.
- 🔲 Per-bucket recurring allocations (e.g. "Mom ₹10k monthly") — pairs with recurring auto-post.
- 🔲 (tech debt) Type-check isn't wired into any npm script; `tsc -p tsconfig.app.json` reports ~16 pre-existing errors (missing `Tag`/`Subscription`/`*WithTags` aliases in `types.ts`, plus `RejectExcessProperties` in Notes/Media/Subscriptions). Worth a cleanup pass.
- 🔲 Per-category budgets with progress bars + over-budget alerts.
- 🔲 Recurring transactions auto-post (`is_recurring`/`recurring_interval` unused).
- 🔲 Receipt attachments (Supabase Storage) + search/filter by description.

## 🔁 Subscriptions
- ✅ Duplicate 4th summary card already removed (cards: Monthly Cost / Yearly Cost / Active / Renews Soon).
- ✅ Mobile sidebar header present (verified).
- 🔲 Renewal reminders (push/email N days before).
- 🔲 Price-change history + annual-vs-monthly savings suggestions.
- 🔲 Cost-per-category breakdown chart.

## 🎂 Birthdays
- ✅ Add/edit Dialog already a single shared `<Dialog>` (both headers call `openAddModal`).
- 🔲 Reminders N days before + gift-idea notes per person.
- 🔲 Import from contacts / CSV; zodiac / age-milestone highlights.

## 🏷️ Tags (cross-cutting)
- ✅ Dead `TagInput.tsx`, `QuickTagButtons.tsx`, and AppSidebar `iconMap` already removed.
- 🔲 Tag management page (rename, merge, recolor, bulk-delete).
- 🔲 Tag hierarchy / nesting.

## 📱 Responsive / Mobile (cross-cutting)
- ✅ **Horizontal-overflow fix (the big one)** — every page's `flex-1` content column lacked `min-w-0`, so the default `min-width:auto` let wide inner grids push the column past the viewport (content bled off-screen, sideways scroll). Added `min-w-0` to all top-level content columns. Also made Dashboard widget `sizeClasses` col-spans responsive (`col-span-1 md:col-span-2 …`) — a `col-span-2` on the mobile `grid-cols-1` was forcing an implicit extra column.
- ✅ **Mobile-safe dialogs** — `ui/dialog.tsx` now `w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6` (was full-bleed `w-full p-6` with no vertical scroll). Fixes every dialog at once.
- ✅ **Mobile-safe sheets** — `ui/sheet.tsx` now scrolls (`overflow-y-auto`) with `p-4 sm:p-6`.
- ✅ **Bigger touch targets** — MediaTracker list-view +/- buttons `h-7 w-7` on mobile (`touch-manipulation`).
- ✅ **Responsive padding/text** — empty-states & page containers `p-4 sm:p-…`; auth/util headings `text-2xl sm:text-3xl`; CheckEmail/NotFound card margins on mobile.
- ✅ Verified on iPhone 14 Pro Max viewport (Media + Dashboard): no horizontal overflow, cards/stats reflow correctly.
- 🔲 MediaTracker is large; further mobile polish of the edit dialog/quick-add flow may be worth a dedicated pass.
- 🔲 Consider a bottom tab bar or persistent mobile nav (sidebar is slide-over only).

## ⚙️ Settings & Platform-wide
- 🔲 Rotate & remove hard-coded `TMDB_API_KEY` in `deploy-edge-function.sh`.
- ✅ Already one toast system (Sonner removed; only shadcn `Toaster`/`use-toast` mounted).
- 🔲 Data import (export exists) + scheduled backup.
- 🔲 Account deletion / data wipe.
- 🔲 PWA push-notification infrastructure (unlocks reminders app-wide).
- 🔲 Add Vitest + smoke tests for the `lib/*` data layer.
- 🔲 Reconcile the two theming paths (`applyTheme` inline vars vs static `:root`/`.dark`).
</content>
</invoke>
