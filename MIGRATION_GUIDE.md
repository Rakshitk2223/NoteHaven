# MongoDB to Supabase Migration Guide

## Summary

Successfully extracted **654 media items** from MongoDB, all with cover images.

**Estimated storage:** 654 items × ~2KB = **~1.3MB** (fits easily in Supabase free tier 500MB limit)

---

## Step 1: Create Table in Supabase

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project: `ylefihvjlyzabhvgdnoe`
3. Go to **SQL Editor**
4. Click **New Query**
5. Copy the contents of `supabase/migrations/03_create_media_metadata.sql`:

```sql
-- Create media_metadata table
CREATE TABLE IF NOT EXISTS public.media_metadata (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT CHECK (type IN ('anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua')),
    cover_image TEXT NOT NULL,
    banner_image TEXT,
    description TEXT,
    rating NUMERIC(3,1) DEFAULT 0,
    status TEXT CHECK (status IN ('ongoing', 'completed', 'upcoming', 'hiatus')) DEFAULT 'upcoming',
    episodes INTEGER,
    chapters INTEGER,
    anilist_id INTEGER,
    tmdb_id INTEGER,
    mal_id INTEGER,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(title, type)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_media_metadata_title ON public.media_metadata(title);
CREATE INDEX IF NOT EXISTS idx_media_metadata_type ON public.media_metadata(type);

-- Enable RLS
ALTER TABLE public.media_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.media_metadata FOR SELECT USING (true);
```

6. Click **Run**

---

## Step 2: Import the Data

The data is in `media_migration.sql` (328KB, 654 INSERT statements).

**Since you can't run scripts directly, you have two options:**

### Option A: Split the SQL file
The file has INSERT statements in batches of 100. You can:
1. Open `media_migration.sql`
2. Copy the first batch (first 100 items)
3. Paste in SQL Editor and run
4. Repeat for remaining batches

### Option B: Use Supabase CLI
If you have Supabase CLI installed:
```bash
supabase db reset
supabase db push
```

**For now, let me show you how to manually import:**

Open `media_migration.sql` in your editor and look for the INSERT sections. Each section looks like:

```sql
INSERT INTO public.media_metadata 
    (title, type, cover_image, banner_image, description, rating, status, episodes, chapters, anilist_id, tmdb_id, mal_id)
VALUES
    ('Title 1', 'anime', 'https://...', ...),
    ('Title 2', 'manga', 'https://...', ...),
    ...
ON CONFLICT (title, type) DO UPDATE SET
    cover_image = EXCLUDED.cover_image,
    ...
```

Copy each batch and run it in SQL Editor.

---

## Step 3: Deploy the Edge Function

The edge function is ready at `supabase/functions/media-search/index.ts`

**Deploy via Supabase Dashboard:**

1. Go to **Edge Functions** in left sidebar
2. Click **New Function**
3. Name: `media-search`
4. Copy the contents of `supabase/functions/media-search/index.ts`
5. Set environment variables:
   - `SUPABASE_URL`: `https://ylefihvjlyzabhvgdnoe.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: (get from Project Settings > API > service_role key)
   - `TMDB_API_KEY`: `381f2d0e99cd3d0cc1e5b9fa1099a9d5`

6. Deploy the function

**Test the function:**
```bash
curl "https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search?q=naruto&type=anime"
```

---

## Step 4: Update Frontend

Replace your API calls with Supabase edge function calls.

**Old code (using backend API):**
```typescript
const response = await fetch(`${import.meta.env.VITE_API_URL}/api/media/search?q=${query}`);
```

**New code (using Supabase edge function):**
```typescript
const { data, error } = await supabase.functions.invoke('media-search', {
  body: { q: query, type: mediaType }
});
```

Or use direct fetch:
```typescript
const response = await fetch(
  `https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search?q=${encodeURIComponent(query)}&type=${type}`
);
const data = await response.json();
```

---

## Step 5: Update Environment Variables

**Remove from `.env`:**
```
VITE_API_URL
MONGODB_URI
PORT
ALLOWED_ORIGINS
RATE_LIMIT_WINDOW_MS
RATE_LIMIT_MAX_REQUESTS
```

**Keep in `.env`:**
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_PROJECT_ID
TMDB_API_KEY (for edge function)
OMDB_API_KEY
SUPABASE_SERVICE_ROLE_KEY (for edge function)
```

---

## Step 6: Cleanup

Once everything works:
1. Delete the `api/` folder
2. Remove `media_export.json` and `media_migration.sql`
3. Remove MongoDB from dependencies
4. Delete the MongoDB Atlas cluster (save money!)

---

## Files Created

- `media_export.json` - JSON export of all 654 media items
- `media_migration.sql` - SQL INSERT statements for Supabase
- `supabase/migrations/03_create_media_metadata.sql` - Table creation SQL
- `supabase/functions/media-search/index.ts` - Edge function code
- `scripts/export-mongodb.ts` - Extraction script (for reference)

---

## What's Different?

**Before (with backend):**
- Frontend → Express API → MongoDB (cached data)
- Express API → External APIs (AniList, TMDB) if not cached
- MongoDB stored everything

**After (Supabase only):**
- Frontend → Supabase Edge Function
- Edge Function → Supabase DB (cached data)
- Edge Function → External APIs if not cached
- Supabase stores everything

**Benefits:**
- ✅ No backend hosting needed
- ✅ No MongoDB hosting needed
- ✅ Everything in Supabase (free tier)
- ✅ Simpler architecture
- ✅ Edge functions auto-scale

---

## Need Help?

If you get stuck importing the data, let me know and I can:
1. Split the SQL into smaller chunks
2. Create a JSON import method
3. Help troubleshoot any issues