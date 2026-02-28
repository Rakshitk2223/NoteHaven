# NoteHaven Media API

Express.js backend for NoteHaven media metadata storage and search.

## Features

- 🔍 **Search**: Search across AniList (anime/manga) and TMDB (movies/series)
- 💾 **Caching**: 24-hour MongoDB cache for search results
- 📊 **Rate Limiting**: 100 requests per 15 minutes
- 🎨 **CORS**: Configured for frontend integration
- 🔒 **Error Handling**: Comprehensive error responses

## Quick Start

### 1. Configure Environment Variables

Create a `.env` file in the `/api` directory:

```bash
cd api
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# MongoDB Connection (from MongoDB Atlas)
MONGODB_URI=mongodb+srv://your_username:your_password@your_cluster.mongodb.net/your_database?retryWrites=true&w=majority

# TMDB API Key (get from https://www.themoviedb.org/settings/api)
TMDB_API_KEY=your_tmdb_api_key_here

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS (frontend URL)
ALLOWED_ORIGINS=http://localhost:5173
```

### 2. Install Dependencies

```bash
cd api
bun install
```

### 3. Start the Server

```bash
# Development mode (with auto-reload)
bun run dev

# Production mode
bun run build
bun run start
```

### 4. Test the API

Open your browser or use curl:

```bash
# Health check
curl http://localhost:3001/health

# Search for anime
curl "http://localhost:3001/api/media/search?q=naruto&type=anime"

# Search for movies
curl "http://localhost:3001/api/media/search?q=avengers&type=movie"

# Search all types
curl "http://localhost:3001/api/media/search?q=attack%20on%20titan"
```

## API Endpoints

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "NoteHaven Media API",
  "version": "1.0.0"
}
```

### GET /api/media/search
Search for media across all sources.

**Query Parameters:**
- `q` (required): Search query string
- `type` (optional): Filter by type - `anime`, `manga`, `manhwa`, `manhua`, `movie`, `series`, `kdrama`, `jdrama`
- `limit` (optional): Number of results (1-50, default: 10)

**Example:**
```bash
GET /api/media/search?q=naruto&type=anime&limit=5
```

**Response:**
```json
{
  "success": true,
  "query": "naruto",
  "type": "anime",
  "count": 5,
  "results": [
    {
      "_id": "65a1b2c3d4e5f6g7h8i9j0k1",
      "title": "Naruto",
      "type": "anime",
      "anilistId": 20,
      "description": "Before Naruto's birth...",
      "genres": ["Action", "Adventure"],
      "coverImage": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx20.jpg",
      "bannerImage": "https://s4.anilist.co/file/anilistcdn/media/anime/banner/20.jpg",
      "rating": 7.9,
      "releaseDate": "2002-10-03T00:00:00.000Z",
      "status": "completed",
      "episodes": 220,
      "searchKeywords": ["naruto", "ナルト"]
    }
  ]
}
```

### GET /api/media/:id
Get detailed information about a specific media item.

**Example:**
```bash
GET /api/media/65a1b2c3d4e5f6g7h8i9j0k1
```

**Response:**
```json
{
  "success": true,
  "media": {
    "_id": "65a1b2c3d4e5f6g7h8i9j0k1",
    "title": "Naruto",
    "type": "anime",
    "description": "...",
    "coverImage": "...",
    "rating": 7.9,
    "status": "completed"
  }
}
```

## Data Sources

### AniList (No API Key Required)
- **Covers**: Anime, Manga, Manhwa, Manhua
- **Rate Limit**: 90 requests/minute
- **Data**: Titles, descriptions, ratings, episode/chapter counts

### TMDB (Requires API Key)
- **Covers**: Movies, Series, KDrama, JDrama
- **Rate Limit**: 40 requests/10 seconds
- **Data**: Titles, descriptions, ratings, episode counts, runtime

### MongoDB (Your Database)
- **Purpose**: Caching search results and storing metadata
- **Collections**: MediaMetadata, MediaCache
- **TTL**: 24-hour cache expiration

## Project Structure

```
api/
├── src/
│   ├── config/
│   │   └── database.ts          # MongoDB connection
│   ├── middleware/
│   │   └── errorHandler.ts      # Error handling
│   ├── models/
│   │   ├── MediaCache.ts        # Cache schema
│   │   └── MediaMetadata.ts     # Media schema
│   ├── routes/
│   │   └── media.ts             # API routes
│   ├── services/
│   │   ├── anilistService.ts    # AniList integration
│   │   ├── mediaService.ts      # Main business logic
│   │   └── tmdbService.ts       # TMDB integration
│   └── index.ts                 # Server entry
├── .env                         # Environment variables
├── .env.example                 # Example env file
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `TMDB_API_KEY` | Yes | TMDB API key for movies/series |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment (development/production) |
| `ALLOWED_ORIGINS` | No | CORS allowed origins |

## Troubleshooting

### MongoDB Connection Failed
```
❌ Failed to connect to MongoDB: ...
```
- Check your `MONGODB_URI` in `.env`
- Ensure IP whitelist in MongoDB Atlas includes your IP
- Verify database user credentials

### TMDB API Errors
```
TMDB API error: ...
```
- Verify `TMDB_API_KEY` is set correctly
- Check rate limits (40 requests per 10 seconds)

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3001
```
- Change `PORT` in `.env` to a different number
- Or kill the process using port 3001

## Next Steps

After the API is running:
1. Update frontend to call `/api/media/search`
2. Display cover images in Media Tracker
3. Add "Import from External" feature
4. Deploy API to production (Railway, Render, etc.)

## License

MIT
