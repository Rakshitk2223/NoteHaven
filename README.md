# NoteHaven

A personal productivity and media companion: notes, tasks, a prompt / snippet / command library, a
media tracker whose titles link to public catalogues (AniList, MangaUpdates, TMDB, …) and keep their
latest chapters and episodes current, a money ledger with accounts, subscriptions, a private file vault,
recipes, a work log, a wishlist, a bucket list, birthdays and a unified calendar, all behind a
customizable dashboard and a ⌘K launcher.

It's a React + TypeScript + Vite single-page app. The whole backend is Supabase: Postgres with row-level
security, Auth, Storage, Realtime, a few RPC functions, and one edge function (`media-search`) that
proxies cover and metadata lookups. There is no other server.

Architecture and conventions are in `CLAUDE.md`, `context/frontend.md` and `context/backend.md`.

## Prerequisites

- **Node 20** (pinned in `.nvmrc`; Node ≥18 and npm ≥9 are enforced) and **npm**. This project uses npm
  only — don't use bun, yarn or pnpm, which create conflicting lockfiles.
- A **Supabase** project and the **Supabase CLI** (to deploy the edge function).
- Optional: a **TMDB** API key (movie and series metadata and posters) and a **Fanart.tv** key.

## Setup

### 1. Install

```bash
git clone git@github.com:Rakshitk2223/NoteHaven.git
cd NoteHaven
nvm use        # optional, matches .nvmrc
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

| Variable | Needed by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | the app | Supabase → Project Settings → API. Public by design; Vite bakes them into the build |
| `VITE_SUPABASE_PROJECT_ID` | — | in the template, unused by the code |
| `VITE_MEDIA_SEARCH_URL` | dev builds only | optional; points the app at the local edge function (`http://127.0.0.1:8787`). Production builds ignore it |
| `SUPABASE_SERVICE_ROLE_KEY` | maintenance scripts | bypasses RLS — never put it in client code |
| `TMDB_API_KEY` | `edge:dev` and `link:dry-run` | optional; the deployed edge function gets its keys from Supabase secrets, not from `.env`. (`OMDB_API_KEY` in the template is unused since `backfill:covers` was removed) |

### 3. Database

In the Supabase SQL editor, run the files in `supabase/migrations/` **in filename order**:

1. `00_baseline_schema.sql` — the full base schema, both Storage buckets (`vault`, `avatars`) and their policies
2. `20_data_cleanup.sql`
3. `21_commands.sql`
4. `22_security_lint.sql`
5. `22_wishlist.sql`
6. `23_work_projects.sql`
7. `24_share_owner_check.sql` … `27_notes_realtime.sql` (fix batch 1: share-owner check, calendar RPC,
   tag counts, notes realtime)
8. `28_media_source_links.sql` — Media v2 source links, `media_source_meta`, `media_progress_log`
9. `29_media_v2_import_link.sql` — the Tachimanga import map, the bulk-change journal, link proposals,
   reader-latest columns, and the Dropped / On Hold statuses. It runs as one transaction and stops,
   changing nothing, if an existing status wouldn't fit the new list

There is no migration runner — don't use `supabase db push`. `00` and `20` are not safe to re-run;
`21` onwards are idempotent.

Then, in the Supabase dashboard, under **Authentication**: enable leaked-password protection, and decide
whether public sign-up should be on (the app has a `/signup` page). Realtime for `notes` is handled by
`27_notes_realtime.sql`.

### 4. Edge function

`media-search` must be deployed with the Supabase CLI so that `supabase/config.toml` (`verify_jwt = true`)
is applied. The script links the project, deploys the function, and sets whichever secrets are present
in your environment:

```bash
supabase login
export TMDB_API_KEY=...                                               # optional
export FANART_API_KEY=...                                             # optional
export ALLOWED_ORIGINS="https://your-app.example,http://localhost:8080"   # CORS; unset means *
./deploy-edge-function.sh
```

The script hard-codes this project's ref (`ylefihvjlyzabhvgdnoe`). For a different project, run the steps
by hand: `supabase link --project-ref <ref>`, `supabase functions deploy media-search`, then
`supabase secrets set NAME=value` for each secret. If you ever deploy from the dashboard instead, check
that JWT verification is **on** — the function holds the service-role key.

### 5. Run

```bash
npm run dev    # http://localhost:8080
npm test       # Vitest (src/**/*.test.ts + the edge function's pure helpers)
```

**Local edge function (Media v2).** To work on `supabase/functions/media-search/` without deploying,
run it locally in real Deno (fetched through npx; no Docker, no Supabase CLI) and point a dev build at it:

```bash
npm run edge:dev                                            # terminal 1: http://127.0.0.1:8787, reads .env
VITE_MEDIA_SEARCH_URL=http://127.0.0.1:8787 npm run dev     # terminal 2 (or put the variable in .env.local)
```

`edge:dev` needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`
(TMDB titles also need `TMDB_API_KEY`). It binds to loopback only and checks every bearer token against
Supabase Auth, as the hosted gateway would. It reads the **production database** but never writes the
shared caches (`media_metadata`, `media_source_meta`) unless you start it with `EDGE_DEV_CACHE_WRITES=1`.
Anything you do in the app through it (progress, links, History) is still a real production write.
Behind a TLS-intercepting proxy, start it with `DENO_TLS_CA_STORE=mozilla,system`. The override is dev-only: production builds ignore `VITE_MEDIA_SEARCH_URL`.

## Build and deploy

```bash
npm run build     # typecheck, then vite build → dist/
npm run preview   # serve dist/ locally
```

- **Frontend:** `dist/` is a static site. Production is on Netlify, which deploys every push to `main`.
  `public/_redirects` (`/* /index.html 200`) is the SPA fallback; any other static host needs the same
  rewrite. The repo contains no other hosting config. The app is a PWA whose service worker updates
  automatically.
- **Edge function:** redeploy with `./deploy-edge-function.sh` whenever
  `supabase/functions/media-search/` changes. (The Media v2 actions on the `media-v2` branch are not
  deployed yet; they go out in one redeploy when that branch merges.)
- **Database:** new migrations are applied by hand in the SQL editor, like step 3.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull
  request: `npm ci`, `npm run lint`, `npm run test:insights`, `npm test`, `npm run build`, and an esbuild
  parse of the edge function. It needs no secrets.

## Maintenance scripts

All run locally (with `tsx`, apart from `edge:dev`) and read `./.env`. The ones that touch the database need
`SUPABASE_SERVICE_ROLE_KEY`; with only the anon key, RLS hides every row.

| Command | What it does |
|---|---|
| `npm run backfill:metadata` | fills `media_metadata` through the deployed edge function, authenticated with the service-role key (`--force`, `--limit N`) |
| `npm run backfill:releases` | fills `media_tracker.release_date` from cached episode data; dry run by default, `--apply` writes |
| `npm run backup:media` | dumps the media tables (tracker, legacy metadata, tags, History, and the migration 29 tables) to `./backups/<timestamp>/` with row counts and SHA-256 checksums |
| `npm run backup:vault` | read-only: downloads every Vault file plus its rows to `./backups/vault-<stamp>/`, with a SHA-256 manifest and `RESTORE.md` |
| `npm run audit:covers -- <export.json> [--list]` | offline: counts (and lists) covers that are the wrong medium, from a Settings → Data export |
| `npm run link:dry-run [-- <export.json>] [--fresh \| --rescore \| --retry-errors]` | Media v2: proposes a source link for every title in an export and reports auto / review / unlinked counts. **Writes nothing** to any database; output goes to `backups/link-dry-run/`. `--rescore` re-scores stored candidates offline |
| `npm run edge:dev` | the local edge function (see Setup, step 5) |
| `npx tsx scripts/make-tachimanga-fixture.ts [--variant minimal\|extra] [--pad-chapters N] [--out path]` | writes a **synthetic** Tachimanga backup for testing the import: every title is invented and prefixed `[audit]`, nothing comes from a real backup. Output defaults to your temp directory, and the script **refuses any path inside the repo** (it's public). `--pad-chapters 225000` makes a ~45 MB library for the phone memory test. To test on an iPhone, rename it to `.zip` so iOS doesn't offer to restore it in the reader app |
| `npm run audit:coverage` | read-only report of metadata coverage per media type (`--list <type>`) |
| `npm run smoke:apis` | hits the upstream media APIs to check the fields the edge function relies on (`--rounds N`) |
| `npm run test:insights` | assertion script for the pure media-insight helpers (also run by CI) |
| `npm test` | Vitest: match scoring, progress rollover and the one progress writer, linking rules, the bulk journal, export / restore, the Tachimanga parser (on synthetic fixtures) and planner, the edge adult filter (also run by CI) |

## Troubleshooting

**Blank screen on start.** Usually a missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: the
Supabase client throws `supabaseUrl is required.` at startup. Check `.env`, then restart the dev server
(Vite reads env files only at startup).

**A title has no cover.** Covers are never searched for automatically. A linked title gets its source's
art when it's linked; otherwise open the title, then ⋮ → Change cover… (it can search the web on request),
or use More → Wrong covers. Search and linking need you signed in, the edge function deployed, its
`TMDB_API_KEY` secret set (movies and series), and `ALLOWED_ORIGINS` including the origin you're browsing
from (the browser console shows CORS errors).

**The edge function returns 401.** Expected without a user session: it accepts a signed-in user's access
token (or the service-role key, for the maintenance scripts) and rejects the anon key. Never deploy it with `--no-verify-jwt`
or turn JWT verification off. To test it by hand, pass a user's access token:

```bash
curl -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer <user access token>" \
  "https://<project-ref>.supabase.co/functions/v1/media-search?q=naruto&type=anime"
```

**Work or Wishlist says "tables not set up".** Run `23_work_projects.sql` or `22_wishlist.sql`.

**Notes don't sync between tabs.** Run `27_notes_realtime.sql`, which adds `notes` to the realtime
publication.

**Signed out on every reload.** Clear the `sb-<project-ref>-auth-token` localStorage entry and sign in
again. The app uses a single Supabase client that stores its session in localStorage.

## Before you push

Run what CI runs: `npm run lint` (zero errors), `npm run test:insights`, `npm test`, `npm run build`.
