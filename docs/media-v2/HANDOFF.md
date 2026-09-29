# Media v2: handoff (2026-09-29, SHIPPED)

This is where a fresh session picks up. Design and decisions: `PLAN.md` ("Re-cut 2026-09-29" is the current
roadmap; § G has unit status). Agent rules: `CLAUDE.md`. Maps: `context/frontend.md`, `context/backend.md`.

## What's live
| Thing | State |
|---|---|
| `main` | **Live on Netlify** at `5dd396d`, the same commit as `media-v2`. Keep working on `media-v2` and fast-forward `main` from it (`git push origin media-v2:main`); every push to main deploys. |
| Prod database | Migrations **00–30 applied** (29: import map, bulk journal, link proposals, reader latest, latest season/episode, Dropped / On Hold, a status CHECK; 30: the `media-covers` bucket + the `media_cover_copies` log). **Next file: `31_*.sql`** (none planned). |
| Edge `media-search` | **Deployed from `media-v2`** with `search` / `detail` (last_aired / next_airing) / `cover_copy`. Secrets: TMDB_API_KEY, ALLOWED_ORIGINS (prod, the media-v2 preview, localhost:8080), COVER_COPY_USERS (only the owner's account may copy covers). Deploy steps: `.claude/butler/reports/E1-deploy-steps.md` (local only) or README. |
| Installed app (PWA) | Updates itself: a check on every page change, on return and every 30 min (`lib/app-update.ts`); reloads wait while a form is dirty or a bulk write is running. |

## What Media does now (U0–U5 + E2, all shipped)
- **Library / Updates / History / Browse / More**, a Mihon-style grid (Grid | List beside Sort), 44px targets,
  and three detail containers (phone full screen, iPad sheet, Mac 420px pane).
- **Log** with compare-and-swap + History (append-only) + Undo; Edit saves in place with "Saved · Undo".
- **Browse** = search-and-pick across type-correct sources; the typed name stays the display name.
- **Tachimanga import** (More → Import…): a `.tmb` is parsed in the browser (sql.js Worker), then shelves → status
  mapping (device-only, default "don't change"), then a preview grouped by change, then the backup gate, Approve,
  and one Undo. Titles not in NoteHaven are never added unless ticked. Re-upload = "Nothing to update".
- **Link your library** (More): a resumable, paced resolver → "Auto-matched · N" (Approve) and "Needs a pick · N"
  (the ReviewCard queue). Linked rows read metadata ONLY from their source (no legacy counts).
- **Updates tab**: the paced update pass by id (latest chapter, or latest aired episode for series); "N behind" =
  max(source, reader latest), never below his progress.
- **Covers**: one judge (`coverVerdict`), one writer (`setCover`, journaled every 5), **every pick, fix,
  import and link copies the image into the `media-covers` bucket first** (`copyCover`; MangaDex art is
  copy-only). "Change cover…" pins the pick; "Wrong covers · N" fixes in bulk behind the backup gate. Web search
  only on tap.
- **Removed:** Refresh Library, Sync activity, has_new_content reads, media-refresh.ts, the cover and metadata
  backfill scripts, display-time cover search.

## First real use (the owner's own steps; agents don't run these on his data)
1. Settings → Data → Export (the in-app backup), plus `npm run backup:media` on a machine with `.env` (behind the
   office proxy: `NODE_OPTIONS=--use-system-ca`). A verified backup exists at `backups/media-2026-09-29T15-46-34`.
2. More → Import… → the real `.tmb` (on the laptop first; the phone is untested with a full-size file).
3. More → Link your library (~1 h for ~1,259 titles; resumable) → Auto-matched → Approve.
4. More → Wrong covers → Fix all (after linking, so source art exists). About 196 wrong covers were counted on 2026-09-29.
5. Phone checklist: `.claude/butler/reports/phone-checklist.md` (local only).

## Known limits / parked (see docs/BACKLOG.md "Parked")
- Cross-source duplicate detection (the same work linked via AniList on one row and MU on another) isn't caught yet.
- ⌘K navigation isn't covered by the dirty-edit guard.
- Storage objects in `media-covers` aren't part of any backup (they can be re-copied from the sources).
- Scan sites (Asura, Reaper…) are NOT scraped. Their covers and chapters arrive through the Tachimanga import.
- The edge's legacy `q=` / `source=` / batch paths have no caller left: dead code, still deployed.

## Rules the owner set (keep them)
- Personal daily driver: Media ≫ Library > Notes > Vault. A finished product over more features; the scope is frozen
  on the roadmap, and new ideas go to BACKLOG "Parked".
- NO HOLES; data safety (additive migrations, backups before bulk writes, Undo on every write, never touch rows
  you didn't create); Tachimanga privacy (agents never open his real backups; synthetic fixtures only).
- Commits: two lines at most, no AI attribution. The repo is public: never commit backups, exports, `.env` or personal data.
