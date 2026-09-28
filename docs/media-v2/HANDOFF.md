# Media v2: handoff (2026-09-28)

This is where a fresh session picks up. The design is in `PLAN.md`, and the Phase 1 work split is in
`PHASE1-BRIEF.md`.

## What exists and where
| Thing | State |
|---|---|
| `main` | **Live.** Netlify auto-deploys every push to main. It includes audit fix batch 1 + 1c and the Media progress hotfix (`8764322`). |
| `media-v2` branch | **Not merged.** All Media v2 Phase 1 work so far. It must NOT be merged before the edge function is redeployed (see "Finish sequence"). |
| Prod database | Migrations **24–28 applied** (28 adds the source links, `media_source_meta` and `media_progress_log`). Nothing else is pending. |
| Edge function `media-search` | Prod runs main's version. The v2 actions (`v2.ts`, `adult.ts`, 2100ms AniList pacing) are on media-v2 and need ONE redeploy at the end. |

## Phase 1 status
| Unit | State |
|---|---|
| B0 local edge dev (`npm run edge:dev`, real Deno via npx, no Docker) | done |
| B1 interface (`src/lib/media-sources.ts`, `src/lib/media-link.ts`) | done |
| B2 migration 28 | done + applied to prod |
| B3 edge actions search / detail / resolve (`supabase/functions/media-search/v2.ts`) | done (local only until redeploy) |
| B4 Vitest + `media-match.ts` + `nextProgress()` | done, `npm test` green |
| B5 refresh linked titles by id (`refreshLinked`) | done |
| Adult-content filter for cache + detail paths (`adult.ts`) | done (needs redeploy) |
| Link dry-run script (`npm run link:dry-run`, read-only, output in gitignored `backups/link-dry-run/`) | done; see results below |
| A1 Mihon grid, Log sheet/popover, 44px ProgressControl, section nav, More view, compare-and-swap progress + History log insert | done; browser gate partial (see below) |
| A2 Browse (search-and-pick), detail page (two-pane on Mac), Fix match, pin cover, History tab | **WIP commit.** DONE: v2 progress engine (compare-and-swap + log + Undo), Browse (SourcePicker/PickPreview, dedup), History (gated on migration 28), Fix match, pin/remove cover + Undo, linked source-detail query, DetailView restructure, Quick Add → Browse. NOT DONE: MediaDetailPanel in its 3 containers + ←/→, removing the footer Close, using detailToMeta as meta, hiding Library-only header controls elsewhere, and A2 browser verification. |
| A3 declutter (remove duplicates, old Quick Add, etc.) | not started |
| Final Phase 1 gate at 390 / 820 / 1180 / 1440 + docs update | not started |

## Results at freeze
**Link dry run (partial: 154 / 1,259 titles):** 41 auto · 101 review · 12 unlinked · 0 errors.
The review count is **inflated**: 73 of those rows are the same work found on two sources (for example
AniList + MangaUpdates), both scoring ≥0.9, and the near-tie rule wrongly treats them as rivals. The fix,
not yet done, is to compare the margin only against a *different* work, then run
`npm run link:dry-run -- --rescore` (offline, since candidates are stored). The expected real review load
is about 30 per 154. Movies can't link locally because there's no TMDB key; prod has one.

**A1 browser gate (partial):**
- **PASS:** section nav (bottom bar + safe area at 390/820, top tabs at 1180/1440, hamburger kept, More);
  grid columns (M 3/4/5/7; S/M/L 8/7/6; the size persists); Log sheet on phone (44px chips, "Log 50
  chapters", Undo) and the popover on Mac (Esc closes it); list controls 44px at 1440; History rows
  written after +1; "Read next" 44px; no horizontal scroll at any width.
- **FAIL (fix in A2/A3):** grid scroll position is lost on Library → More → Library. The initials
  placeholder picks up leading punctuation ("[" for "[audit]…"), and failed images stay blank instead of
  falling back to the letter tile.
- **Not run yet:** the two-tab compare-and-swap conflict, the behind badge, long-press select, the
  drawer, and list controls at 390.
- **Seen:** a one-off HMR hook-order crash in dev (gone after reload; not a shipping bug). A movie got its
  sequel's poster (a title-match edge case; add it as a media-match test).

## Done since freeze (2026-09-28, late)
- Perf gate fixed: cold-load 236.6 KiB gz (gate 237). media-link is lazy now.
- Dry-run near-tie fixed (the same work on two sources isn't a rival). Rescored **435 / 1,259 → 342 auto ·
  76 review · 17 unlinked** (review 66% → 17%). Movies stay unlinked locally (no TMDB key).
- A1 gate FAILs fixed (scroll kept per section, clean initials, letter-tile cover fallback). These need a
  browser re-check at 390 / 1440.

- **A2 finished** (43c97dc): MediaDetailPanel as a phone full-screen sheet, iPad side sheet, and Mac 420px
  pane with ‹ › / ←/→ / Esc; no footer Close; linked titles use source metadata; Library-only controls
  hidden on other sections. Media chunk 46.18 KiB gz. Cold load 236.68 KiB (gzip -9) / **237.29 (default
  gzip)**, which is right at the 237 gate. Pick ONE measurement method and trim if needed.

- **Edit-loss hole closed** (073448e): any title switch or close with unsaved changes asks "Discard
  changes?". Unsaved tag edits are no longer wiped by background patches.
- **A3 declutter done** (144c0cf): status shown once; one ⋮ MediaActionsMenu (pin, refresh, remove cover,
  delete); 44px ⋮ on list rows; Edit focuses the progress field; the 1180 chip row scrolls with Group
  and settings pinned; Movies get a Watched toggle with Undo; no Quick Add trace left. Media chunk 47.15
  KiB gz.

## First fixes when resuming
1. Browser-verify A2 + A3 (the UX pass may be partial; see below): the discard prompt in all 3 layouts, ⋮
   at 390 / 1440, chips at 1180, the Movies toggle, the Mac two-pane, the iPad and phone sheets, Browse,
   Fix match, pin, History.
2. Run the full Phase 1 browser gate, including the A1 checks that weren't run and the re-check of the
   three fixes above.

## Local dev
```
npm install
npm run edge:dev                                            # terminal 1: local edge fn on 127.0.0.1:8787 (reads .env)
VITE_MEDIA_SEARCH_URL=http://127.0.0.1:8787 npm run dev     # terminal 2: app on :8080 using the local edge
npm test                                                    # Vitest
npm run build && npm run lint                               # 0 lint errors is the bar
```
The `VITE_MEDIA_SEARCH_URL` override only works in dev builds. The local edge uses PROD data, so cache
writes are real.

## Finish sequence (Phase 1 ship)
1. Finish A2, then A3, then the full browser gate (the plan's "Definition of done: NO HOLES").
2. Merge `main` into `media-v2`. `main` has hotfix `8764322` in the OLD `MediaTracker.tsx`. v2 replaced
   that code, so keep v2's version, **but first confirm v2 has both protections**: (a) cancel in-flight
   list queries before an optimistic +1, and (b) the Edit form writes progress only when it changed.
3. Deploy the edge function (this office network blocks the Supabase CLI login, so use another machine):
   `supabase login` → `supabase link --project-ref ylefihvjlyzabhvgdnoe` →
   `supabase functions deploy media-search` → `supabase secrets list` (check TMDB_API_KEY and
   ALLOWED_ORIGINS).
4. Push `media-v2` into `main`, and Netlify deploys it.

## After Phase 1
- **Phase 2, Link your library:** a background resolver plus a review queue (top 3 candidates each). The
  dry run sizes it. Back up first.
- **Phase 3:** the Updates tab (latest chapter / "N behind"), platform + resume link, hold-to-repeat,
  season picker, and removing Refresh Library once metadata fills itself.

## Rules the owner set (keep them)
- It's his personal daily driver. Usage ranks **Media ≫ Library > Notes > Vault**. Optimise for speed, few
  taps and phone use.
- **No holes:** nothing ships half-wired, and whatever a phase replaces is removed in the same phase.
- **Data safety:** migrations only add; refresh and linking never touch user-owned fields; never delete or
  overwrite rows you didn't create; take a backup before any bulk write.
- **Declined:** push notifications and recommendations. Multi-device Notes conflict handling is backlog.
- Commits: two lines at most, no AI attribution.
- The repo is **public**, so never commit backups, exports, `.env` or personal data.
