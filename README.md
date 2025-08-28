## NoteHaven

Personal productivity & media companion built with React + TypeScript + Vite + Supabase.

### Features
- Email/password auth (single Supabase client)
- Notes (auto-save), Tasks, Media Tracker, AI Prompts, Favorites
- Dashboard overview & stats
- Row Level Security (user owns their data)
- Environment-driven configuration (Vite `VITE_` vars)

### Tech Stack
- React 18, TypeScript, Vite
- Supabase (Auth + Postgres)
- Tailwind CSS + shadcn/ui components
- React Router, React Query

### Getting Started
1. Clone & install:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill values:
   ```bash
   VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
   VITE_SUPABASE_PROJECT_ID="YOUR_PROJECT_REF"
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Open the shown local URL (default http://localhost:5173 unless configured).

### Production Build
```bash
npm run build
npm run preview
```

### Database Schema (summary)
Tables: `prompts`, `notes`, `tasks`, `media_tracker` (all include `user_id` + timestamps). Additional columns: `is_favorited`, `updated_at` with triggers.

### RLS Policy Pattern
Grant row access only when `auth.uid() = user_id` for each CRUD verb.

### Supabase Client
`src/integrations/supabase/client.ts` exports the singleton. Do not call `createClient` elsewhere.

### Troubleshooting
Blank screen:
1. Check DevTools console for runtime errors.
2. Verify env vars: `import.meta.env.VITE_SUPABASE_URL`.
3. Ensure migrations added required columns (`is_favorited`, `updated_at`).

Auth not persisting: confirm only one client; clear localStorage and sign in again.

### Contributing
PRs welcome. Run lint & build before submitting.

### License
MIT
