# Media Page — UX Redesign Tracker

Goal: address the UI/UX critique (not just code). Worked in verifiable stages.

Status: [x] done

Verification: `tsc --noEmit` passes, `vite build` succeeds, no diagnostics on changed
files, ESLint at/under pre-existing baseline (only the same pre-existing `any`/`no-empty`
items remain; no new errors introduced).

## Stages
1. [x] Card redesign (`MediaCard.tsx`)
   - Inline progress steppers on the card (the core "I watched one more episode" action) —
     previously only possible in list view or the edit sheet.
   - Lighter hover treatment: poster stays visible; subtle bottom gradient instead of a
     full black overlay.
   - Actions consolidated into a kebab (⋮) menu: Edit / Refresh cover / Delete.
   - Real selection checkbox (top-right) instead of a hidden "Select" button; visible on
     hover/focus or when selected; works on touch.
   - Letter-tile fallback for missing covers (no more walls of identical placeholders).
   - Reduced badge noise: one type badge on the poster; status shown as a small colored
     dot + label under the title; rating moved to a compact corner chip.
   - Clicking the cover opens the details view.

2. [x] Single category axis (`CustomGroupBuilder.tsx` → unified category bar)
   - Merged the separate Type Tabs and Custom Groups into ONE mutually-exclusive pill row:
     All → enabled type pills → custom groups → add-group → manage-types.
   - Eliminates the dual-axis (Tab × Group) empty-intersection problem.
   - Single source of truth: `activeCategory` = 'all' | 'type:<T>' | '<groupId>'
     (persisted to localStorage as `mediaTrackerActiveCategory`).
   - Per-type counts added to the counts query so type pills show counts too.

3. [x] Unified filter/sort surface + active-filter chips
   - Filters sheet now holds Status, Sort (by + direction), Needs cover (Switch), and Tags,
     with separators and clearer labels.
   - Sort expanded beyond title: Title / Rating / Recently updated / Date added, with
     asc/desc (query orders dynamically, nulls last, stable title secondary sort).
     Persisted as `mediaTrackerSortBy`.
   - Removable active-filter chips render above the grid (search, category, status, needs
     cover, each tag) with a "Clear all".
   - Filters button shows a numeric active-filter count (desktop + mobile badge).

4. [x] Meaningful bulk actions
   - Selection toolbar appears in selection mode: count, Select all (visible), bulk Set
     status, Refresh covers (with busy state), bulk Delete (confirmed), Cancel.
   - Bulk delete uses a ConfirmDialog.

5. [x] Condensed chrome / mobile
   - Removed the extra tab row + loose "Manage Tabs"/"Needs Cover" button row; the category
     bar + chips replace them.
   - Mobile header: Add (primary), Filters (with count badge), and a single view toggle
     that flips grid/list (was two buttons). Less crammed.
   - Duplicate "Manage Tabs" dropdown item already removed earlier; "Manage types" now lives
     as an icon at the end of the category bar.

6. [x] Verify — tsc clean, build OK, diagnostics clean.

## Notes
- All shadcn components used already existed locally (dropdown-menu, tooltip, switch,
  separator, checkbox). No web search or new dependencies were needed.
- Behavior change: progress minimum stays at 1 (existing handler behavior preserved).
