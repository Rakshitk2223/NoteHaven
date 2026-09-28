# Media v2 · Phase 1: link, fetch by id, log fast (Mihon Library)

Read first: the plan at `/Users/o365_admin/.claude/plans/virtual-petting-swing.md` (the **Definition of
done: NO HOLES** section is binding), `briefs/_common.md` (data safety still applies), and
`briefs/media-focus.md`. The approved look is the demo's **Direction A** (Mihon Library):
https://claude.ai/artifact/CYGnLNArE56iqP2wVwRGBL (source:
`/private/tmp/claude-502/-Users-o365-admin-temp-Rak-Projects-personal-NoteHaven/e5b379f0-8d13-44d8-9914-226a5e98e7b9/scratchpad/media-demo/media-v2-directions.html`).
Match its interactions, not its CSS. Build with the app's Aurora tokens, shadcn primitives and `motion.tsx`.

## Ground rules for this round
- **Branch `media-v2`** is checked out. The butler is the ONLY git owner, so lanes do no git ops of any
  kind. The butler commits per verified unit.
- **Prod reality:** `main` auto-deploys the site. The edge function will be deployed **once, at the very
  end**, from Rakshit's personal laptop. So nothing here gets merged or pushed to main until that final
  step, and **dev verification must run against a LOCAL edge function** (see B0).
- SQL goes into files only. Rakshit runs them in the SQL editor on this laptop, when asked.
- Fields the user owns are never written by refresh or linking code. Every write gets Undo. Migrations
  only add.

## Writer B: notehaven-backend
**Lock:** `supabase/**`, `src/lib/**`, `src/integrations/supabase/types.ts`, `scripts/**`, `package.json`
(scripts + devDependencies), `package-lock.json`, `vitest.config.*`, `.github/workflows/ci.yml`.
- **B0 · Local edge dev (unblock everything first):** find a way to run `media-search` locally with NO
  Docker (Docker isn't installed; the office network blocks the Supabase CLI login). Try Deno via npx or
  the npm `deno` package first. If it truly needs `brew install deno`, ask the butler, because that's
  Rakshit's machine. Add a **dev-only** override in `src/lib/edge-function.ts`:
  `import.meta.env.DEV && import.meta.env.VITE_MEDIA_SEARCH_URL` → local URL, never used in prod builds.
  Add a `npm run edge:dev` script. Read secrets from `.env` without printing them. Write a one-paragraph
  how-to in your report.
- **B1 · Interface first (by ~30 min):** publish typed signatures (stubs are fine) in
  `src/lib/media-sources.ts` (`searchSources`, `fetchSourceDetail`, `resolveBatch`, plus `Candidate` /
  `SourceDetail` types) and `src/lib/media-link.ts` (`linkEntry`, `unlinkEntry`, `setCoverPinned`), so Writer A
  can build against them. Ping the butler when it lands.
- **B2 · Migration `28_media_source_links.sql`:** exactly as in the plan's Architecture section:
  tracker link columns, `media_source_meta` (edge-only writes), `media_progress_log` (append-only,
  RLS by user), `latest_changed_at`. It must be idempotent and pass a fresh 00→28 run plus a re-run in
  PGlite. Update `types.ts` by hand.
- **B3 · Edge actions:** `action=search|detail|resolve` per the plan, **type-correct sources only**.
  Candidates carry their own ids; no `0`/`'upcoming'` placeholders; statuses normalised; adult filters
  kept; AniList paced at ≥2100ms. Nothing is persisted from search; `detail` upserts `media_source_meta`.
  The old `q=` path stays working, because unlinked entries still use it.
- **B4 · Pure logic + Vitest (the backlog item he kept):** set up Vitest for `src/lib`. Write
  `media-match.ts` (scoring; tests must include the "Book eating magicians" case → the MKR manhwa, not the
  novel; Naruto ≠ Boruto; "The" and plural variants) and `nextProgress()` in `media-progress.ts` (rollover
  and clamp tests). Hook `npm test` into ci.yml.
- **B5 · Link + refresh by id:** in `media-link.ts`, `linkEntry` writes link fields only, fetches detail,
  and sets the cover only if it isn't pinned and (for existing entries) only when the current cover fails
  `isUsableCover`, unless the user explicitly chose "use new cover". Refresh for linked entries fetches by
  id and is **idempotent**: two refreshes in a row give identical rows.

## Writer A: notehaven-frontend
**Lock:** `src/pages/MediaTracker.tsx`, `src/components/media/**` (new and existing),
`src/hooks/media/**` (new), `src/pages/Dashboard.tsx` (Media widget only, if touched), `src/App.tsx`
(routes only). Everything else is read-only; ask the butler.
- **A1 · Foundations (no backend needed, start now):**
  - Extract along the seams in your Media deep-dive (`useMediaLibrary`, `useMediaMutations`,
    `useMediaFilters`, `MediaDetail`, `MediaActionsMenu`…).
  - Build `useProgressMutation` on the compare-and-swap writer. Log rows go in as a **separate insert
    after the confirmed UPDATE**: never blocking, append-only, Undo = a reverse row, and the insert is
    skipped silently if `media_progress_log` doesn't exist yet (PGRST205/42P01).
  - Build `ProgressControl` (44px) and `LogSheet` (big numeric input, +1/+5/+10/+50, Undo toast; a
    popover on Mac).
  - Build the Mihon Library grid (3 / 4–5 / 6–8 columns, S/M/L size remembered in localStorage, and the
    behind badge only when a latest is known).
  - Build the section nav: phone bottom bar with Media sections only, hamburger kept, safe-area padding;
    iPad bottom or top per orientation; Mac top tabs. **Phase 1 tabs are Library · History · Browse ·
    More. No Updates tab yet.**
- **A2 · Against B1's interface:**
  - **Browse = search-and-pick.** Source columns on Mac, rows elsewhere. The novel-type decoy is dimmed.
    Preview → status + progress → Add. "Add without linking" is always there. It **replaces** Quick Add
    and the empty-state form, so delete those.
  - **Detail page:** full screen on phone, side sheet on iPad, **two-pane on Mac** (←/→ steps through
    titles). Hero, action row (Log · Open where I read ↗ once platform exists · Fix match · Pin cover),
    3-line synopsis, progress, genres, seasons/episodes, cast.
  - **Fix match** reuses the picker.
  - **History tab** reads `media_progress_log`. Until migration 28 is run, the tab is hidden, not
    empty. (Rule 2: nothing shows until it works.)
- **A3 · Declutter in the same phase:** the plan's Phase 1 quick-win list (duplicate status, rating and
  edit; footer Close; kebab cover actions; Delete into a kebab; UX-18 / UX-23 / UX-16 / UX-17; one
  `MediaActionsMenu`; iPad 1180 clipping). Movies get "Watched ✓".
- **More tab** lists only things that work today: stats, export/import, grid size, groups, and Refresh
  Library, which stays until the phase-2 autopilot replaces it.

## notehaven-ux: phase gate
After A1, and again after A2 + A3: every surface at 390 / 820 / 1180 / 1440, including empty, loading,
error and offline states; add, link, log, Fix match, pin and history with `[audit]` rows; 44px targets
measured; no horizontal scroll; cold-load JS ≤ 236 KiB gz, plus the Media chunk size before and after.
The write guard stays on. Run against the LOCAL edge function once B0 lands.

## Pings
Writers ping at each unit (A1, A2, A3 / B0, B1, B2, B3, B4, B5), with `file:line`, `tsc` for B and
build + lint for A. Keep pings under 8 lines.
