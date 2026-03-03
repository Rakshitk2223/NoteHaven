# NoteHaven

Personal productivity & media companion built with React + TypeScript + Vite + Supabase + MongoDB.

## Features

- **Authentication**: Email/password auth via Supabase Auth
- **Notes**: Auto-save with rich text support, tagging, sharing
- **Tasks**: Due dates, pinning, completion tracking
- **Media Tracker**: Track movies, series, anime, manga with automatic cover images from AniList/Jikan
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
- **Backend API**: Express.js with TypeScript
- **Database**: 
  - Supabase (PostgreSQL) for user data
  - MongoDB for media metadata and cover images
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: React Query (TanStack Query)
- **Routing**: React Router v6

## Prerequisites

- Node.js 18+
- Bun package manager
- MongoDB Atlas account (for media metadata)
- Supabase account

## Getting Started

### 1. Clone & Install

```bash
git clone <repository-url>
cd NoteHaven
bun install
cd api && bun install
```

### 2. Environment Setup

Create `.env` in the root directory:

```bash
# Supabase
VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
VITE_SUPABASE_PROJECT_ID="YOUR_PROJECT_REF"

# API (for media covers)
VITE_API_URL="http://localhost:3001"
```

Create `api/.env`:

```bash
# MongoDB
MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/notehaven?retryWrites=true&w=majority"

# External APIs (optional - used for media metadata)
TMDB_API_KEY="your_tmdb_api_key"

# Server
PORT=3001
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
```

### 3. Database Setup

Run the consolidated migration files in Supabase SQL Editor:

1. First, run `supabase/migrations/01_create_base_schema.sql`
2. Then, run `supabase/migrations/02_add_all_features.sql`

### 4. Start Development Servers

Terminal 1 - Backend API:
```bash
cd api
bun run dev
```

Terminal 2 - Frontend:
```bash
bun run dev
```

The app will be available at http://localhost:5173

## Production Build

```bash
# Build frontend
bun run build

# Build backend API
cd api && bun run build
```

## Architecture

### Frontend
- `src/pages/` - Page components
- `src/components/` - Reusable UI components
- `src/lib/` - Utility functions and API clients
- `src/hooks/` - Custom React hooks
- `src/integrations/supabase/` - Supabase client and types

### Backend API
- `api/src/routes/` - API route handlers
- `api/src/services/` - External API integrations (AniList, Jikan, TMDB)
- `api/src/models/` - MongoDB/Mongoose models

### Database Schema

**Supabase (PostgreSQL)** - User Data:
- `tasks`, `notes`, `prompts`, `media_tracker`
- `tags` with junction tables for many-to-many relationships
- `ledger_categories`, `ledger_entries` (money tracking)
- `subscription_categories`, `subscriptions`
- `birthdays`, `countdowns`, `shared_notes`, `code_snippets`

**MongoDB** - Media Metadata:
- `MediaMetadata` - Cover images, descriptions, ratings from external APIs
- All media cover images cached for performance

### RLS Policy Pattern

All tables use Row Level Security (RLS):
```sql
CREATE POLICY "Users can manage their own data"
  ON table_name FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

## Media Cover Images

Cover images are fetched automatically using this cascade:
1. **Check MongoDB** - Fast cache lookup
2. **AniList API** - Primary source for anime/manga
3. **Jikan API** - Fallback for anime/manga (MyAnimeList data)
4. **MangaDex API** - Final fallback for manga/manhwa/manhua

All fetched images are saved to MongoDB for future requests.

## Troubleshooting

**Blank screen:**
1. Check DevTools console for runtime errors
2. Verify env vars are loaded: `import.meta.env.VITE_SUPABASE_URL`
3. Ensure database migrations have been applied

**Media covers not loading:**
1. Check that backend API is running on port 3001
2. Verify MongoDB connection string in `api/.env`
3. Check browser console for API errors

**Auth not persisting:**
1. Confirm only one Supabase client exists
2. Clear localStorage and sign in again
3. Check RLS policies are correct

## Contributing

PRs welcome. Before submitting:
1. Run `bun run lint` to check code style
2. Run `bun run build` to verify build succeeds
3. Test your changes locally

## License

MIT
