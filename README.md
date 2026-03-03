# NoteHaven

Personal productivity & media companion built with React + TypeScript + Vite + Supabase.

## Features

- **Authentication**: Email/password auth via Supabase Auth
- **Notes**: Auto-save with rich text support, tagging, sharing
- **Tasks**: Due dates, pinning, completion tracking
- **Media Tracker**: Track movies, series, anime, manga with automatic cover images from AniList/Jikan/TMDB
- **AI Prompts**: Save and organize AI prompts with categories
- **Money Ledger**: Track income and expenses with categories
- **Subscriptions**: Monitor recurring subscriptions with renewal alerts
- **Birthdays**: Never forget important dates
- **Countdowns**: Track upcoming events
- **Calendar View**: Unified view of all time-based data
- **Code Snippets**: Store and organize code snippets
- **Tags System**: Tag anything across all features

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase Edge Functions (serverless)
- **Database**: Supabase (PostgreSQL) - everything in one place
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: React Query (TanStack Query)
- **Routing**: React Router v6

## Architecture

**Before:** Frontend → Express API → MongoDB (images) + Supabase (auth/data)  
**After:** Frontend → Supabase Edge Function → Supabase DB (everything!)

All data including cover images are now stored in Supabase. No separate backend hosting needed!

## Prerequisites

- Node.js 18+ or Bun
- Supabase account
- (Optional) TMDB API key for movie/series covers

## Getting Started

### 1. Clone & Install

```bash
git clone <repository-url>
cd NoteHaven
bun install
```

### 2. Environment Setup

Create `.env` in the root directory:

```bash
# Supabase (Required)
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
VITE_SUPABASE_PROJECT_ID="your-project-ref"

# External APIs (Optional - for fetching new cover images)
TMDB_API_KEY="your_tmdb_api_key"
OMDB_API_KEY="your_omdb_api_key"

# Supabase Service Role Key (for edge functions only)
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

### 3. Database Setup

Run the migration files in Supabase SQL Editor in order:

1. `supabase/migrations/01_create_base_schema.sql` - Core tables
2. `supabase/migrations/02_add_all_features.sql` - Additional features
3. `supabase/migrations/03_create_media_metadata.sql` - Media cover images

### 4. Deploy Edge Function

Deploy the media-search edge function:

```bash
# Login to Supabase
supabase login

# Deploy the function
supabase functions deploy media-search --no-verify-jwt

# Set environment variables for the function
supabase secrets set TMDB_API_KEY="your_tmdb_api_key"
```

Or deploy manually via Supabase Dashboard:
1. Go to Edge Functions → New Function
2. Name: `media-search`
3. Copy code from `supabase/functions/media-search/index.ts`
4. Add secret: `TMDB_API_KEY`
5. Deploy

### 5. Start Development

```bash
bun run dev
```

The app will be available at http://localhost:5173

## Production Build

```bash
bun run build
```

## Project Structure

### Frontend
- `src/pages/` - Page components
- `src/components/` - Reusable UI components
- `src/lib/` - Utility functions and API clients
  - `media-api.ts` - Media search via Supabase edge function
  - `simple-image-fetcher.ts` - Cover image fetching
- `src/hooks/` - Custom React hooks
- `src/integrations/supabase/` - Supabase client and types

### Supabase
- `supabase/functions/media-search/` - Edge function for media search
- `supabase/migrations/` - Database schema migrations

### Database Schema

**Supabase (PostgreSQL)** - All Data:

**Core Tables:**
- `tasks`, `notes`, `prompts`, `media_tracker` - Main features
- `tags` with junction tables for many-to-many relationships
- `ledger_categories`, `ledger_entries` - Money tracking
- `subscription_categories`, `subscriptions` - Subscription monitoring
- `birthdays`, `countdowns`, `shared_notes`, `code_snippets` - Additional features

**Media Metadata:**
- `media_metadata` - Cover images, descriptions, ratings cached from external APIs
- 653+ media items pre-cached

### RLS Policy Pattern

All user tables use Row Level Security (RLS):
```sql
CREATE POLICY "Users can manage their own data"
  ON table_name FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Public tables (like `media_metadata`) allow read access to all:
```sql
CREATE POLICY "Allow public read access" 
  ON media_metadata FOR SELECT USING (true);
```

## Media Cover Images

Cover images are fetched automatically using this cascade:
1. **Check Supabase** - Fast database lookup (653+ items cached)
2. **AniList API** - Primary source for anime/manga (no key needed)
3. **Jikan API** - Fallback for anime/manga (no key needed)
4. **TMDB API** - For movies/series (API key required)

All newly fetched images are saved to Supabase for future requests.

## Edge Function

The `media-search` edge function is deployed at:
```
https://your-project-ref.supabase.co/functions/v1/media-search?q=QUERY&type=TYPE
```

**Query Parameters:**
- `q` - Search query (required)
- `type` - Media type: anime, manga, movie, series, kdrama, jdrama (optional)
- `limit` - Max results (default: 10)

**Example:**
```bash
curl "https://your-project.supabase.co/functions/v1/media-search?q=naruto&type=anime"
```

## Troubleshooting

**Blank screen:**
1. Check DevTools console for runtime errors
2. Verify env vars are loaded: `import.meta.env.VITE_SUPABASE_URL`
3. Ensure database migrations have been applied

**Media covers not loading:**
1. Check that edge function is deployed: Supabase Dashboard → Edge Functions
2. Test the function directly with curl
3. Check browser console for CORS errors
4. Verify edge function environment variables are set

**Edge function returning 401:**
- Make sure you deployed with `--no-verify-jwt` flag
- Or configure the function to allow anonymous access in Supabase Dashboard

**Auth not persisting:**
1. Confirm only one Supabase client exists
2. Clear localStorage and sign in again
3. Check RLS policies are correct

## Migration from Old Architecture

If you're migrating from the Express + MongoDB setup:

1. ✅ Data already migrated to Supabase (653 media items)
2. ✅ Edge function deployed
3. ✅ Frontend updated to use Supabase
4. 🗑️ Delete old `api/` folder (already done)
5. 🗑️ Delete MongoDB Atlas cluster (do this manually to save money)

See `MIGRATION_COMPLETE.md` for detailed migration notes.

## Cost Savings

**Old Architecture:**
- Frontend hosting (Netlify/Vercel) - Free tier
- Backend hosting (Render/Railway) - $5-10/month
- MongoDB Atlas - $0-5/month

**New Architecture:**
- Frontend hosting (Netlify/Vercel) - Free tier
- Supabase - Free tier (using ~2MB of 500MB storage)

**Savings:** $5-15/month

## Contributing

PRs welcome. Before submitting:
1. Run `bun run lint` to check code style
2. Run `bun run build` to verify build succeeds
3. Test your changes locally

## License

MIT