# NoteHaven — Pending Fixes

Only open items remain below. Legend: 🔴 security/bug · 🔵 refactor.

---

## 🔴 Security / ops

### 1. Browser-side TMDB/OMDB cover refresh can never work
- **File:** `src/lib/media-refresh.ts`
- **Problem:** Reads `import.meta.env.TMDB_API_KEY` / `OMDB_API_KEY`, which aren't `VITE_`-prefixed → always `undefined` in the browser, so those API branches silently no-op.
- **Fix:** Route TMDB/OMDB lookups through the Supabase edge function (which already holds `TMDB_API_KEY`), like MangaUpdates already is. Don't expose keys to the browser.
- **Status:** [ ] open

### 2. Hard-coded `TMDB_API_KEY` committed to VCS
- **File:** `deploy-edge-function.sh`
- **Problem:** A live API key literal is checked into the repo.
- **Fix:** **You** rotate the key in TMDB first (can't rotate a third-party secret for you); then read it from env/secret at deploy time and remove the literal.
- **Status:** [ ] open — needs your action

---

## 🔵 Larger refactors (deferred on purpose)

### 3. Realtime note sync is intricate/fragile
- **File:** `src/pages/Notes.tsx`
- **Problem:** Multiple refs (`hasLocalChangesRef`, `localEditTimestampRef`, `lastLoadedNoteIdRef`), debounced per-field saves, and a per-save conflict re-read. Possible source of subtle "edit reverted" bugs.
- **Fix:** Extract into a dedicated `useNoteAutosave` hook with clear conflict semantics + tests.
- **Status:** [ ] open

### 4. Inconsistent server-state strategy + repeated `getUser()`
- **Files:** all pages (esp. `src/pages/Dashboard.tsx`)
- **Problem:** MediaTracker uses React Query (caching, optimistic updates); other pages use manual `useState`/`Promise.all` with duplicated loading/error patterns. Many fetch helpers call `supabase.auth.getUser()` instead of reading from `useAuth()`.
- **Fix:** Migrate list pages to React Query incrementally and thread the user from `useAuth()` into fetch helpers.
- **Status:** [ ] open

---

## Notes
- Optional polish: fully unify `src/index.css` static tokens with `src/lib/themes.ts` (the dark/light first-paint flash is already fixed via an inline script in `index.html`).
- All current changes are staged but **not committed**.
