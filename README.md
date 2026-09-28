# NoteHaven

A personal productivity and media companion: notes, tasks, a prompt / snippet / command library, a
media tracker with automatic covers, a money ledger with accounts, subscriptions, a private file vault,
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
| `SUPABASE_SERVICE_ROLE_KEY` | maintenance scripts | bypasses RLS — never put it in client code |
| `TMDB_API_KEY`, `OMDB_API_KEY` | `backfill:covers` script | optional; the deployed edge function gets its keys from Supabase secrets, not from `.env` |

### 3. Database

In the Supabase SQL editor, run the files in `supabase/migrations/` **in filename order**:

1. `00_baseline_schema.sql` — the full base schema, both Storage buckets (`vault`, `avatars`) and their policies
2. `20_data_cleanup.sql`
3. `21_commands.sql`
4. `22_security_lint.sql`
5. `22_wishlist.sql`
6. `23_work_projects.sql`

There is no migration runner — don't use `supabase db push`. Run each file once; `00` and `20` are not
safe to re-run.

> **Known limitation:** `00_baseline_schema.sql` can't currently build an empty project (it references
> `subscriptions.ledger_entry_id` before the column is created). It's tracked in `docs/BACKLOG.md`.

Then, in the Supabase dashboard:
- **Database → Publications → `supabase_realtime`:** enable the `notes` table. Notes syncs open tabs over
  realtime, and no migration turns this on.
- **Authentication:** enable leaked-password protection, and decide whether public sign-up should be on
  (the app has a `/signup` page).

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
```

## Build and deploy

```bash
npm run build     # typecheck, then vite build → dist/
npm run preview   # serve dist/ locally
```

- **Frontend:** `dist/` is a static site. `public/_redirects` (`/* /index.html 200`) is the Netlify-style
  SPA fallback; any other static host needs the same rewrite. The repo contains no other hosting config.
  The app is a PWA whose service worker updates automatically.
- **Edge function:** redeploy with `./deploy-edge-function.sh` whenever
  `supabase/functions/media-search/` changes.
- **Database:** new migrations are applied by hand in the SQL editor, like step 3.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull
  request: `npm ci`, `npm run lint`, `npm run test:insights`, `npm run build`, and an esbuild parse of
  the edge function. It needs no secrets.

## Maintenance scripts

All run locally with `tsx` and read `./.env`. The ones that touch the database need
`SUPABASE_SERVICE_ROLE_KEY`; with only the anon key, RLS hides every row.

| Command | What it does |
|---|---|
| `npm run backfill:covers` | fills missing `media_tracker.cover_image`, calling AniList, Kitsu, Jikan, MangaDex, MangaUpdates, TVmaze, TMDB and OMDB directly |
| `npm run backfill:metadata` | fills `media_metadata` through the deployed edge function (`--force`, `--limit N`). **Currently fails with 401** — it doesn't send an auth token (`docs/BACKLOG.md`) |
| `npm run backfill:releases` | fills `media_tracker.release_date` from cached episode data; dry run by default, `--apply` writes |
| `npm run backup:media` | dumps the media tables to `./backups/<timestamp>/` with row counts and SHA-256 checksums |
| `npm run audit:coverage` | read-only report of metadata coverage per media type (`--list <type>`) |
| `npm run smoke:apis` | hits the upstream media APIs to check the fields the edge function relies on (`--rounds N`) |
| `npm run test:insights` | assertion script for the pure media-insight helpers (also run by CI) |

## Troubleshooting

**Blank screen on start.** Usually a missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: the
Supabase client throws `supabaseUrl is required.` at startup. Check `.env`, then restart the dev server
(Vite reads env files only at startup).

**Media covers don't load.** You must be signed in — the edge function rejects anonymous calls. Then
check that the function is deployed, its `TMDB_API_KEY` secret is set (movies and series), and
`ALLOWED_ORIGINS` includes the origin you're browsing from (the browser console shows CORS errors).

**The edge function returns 401.** Expected without a user session: it accepts only a signed-in user's
access token, and rejects the anon key and the service-role key. Never deploy it with `--no-verify-jwt`
or turn JWT verification off. To test it by hand, pass a user's access token:

```bash
curl -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer <user access token>" \
  "https://<project-ref>.supabase.co/functions/v1/media-search?q=naruto&type=anime"
```

**Work or Wishlist says "tables not set up".** Run `23_work_projects.sql` or `22_wishlist.sql`.

**Notes don't sync between tabs.** Enable realtime for the `notes` table (Setup, step 3).

**Signed out on every reload.** Clear the `sb-<project-ref>-auth-token` localStorage entry and sign in
again. The app uses a single Supabase client that stores its session in localStorage.

## Before you push

Run what CI runs: `npm run lint` (zero errors), `npm run test:insights`, `npm run build`.
