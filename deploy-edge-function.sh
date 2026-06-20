#!/bin/bash

# Supabase Edge Function Deployment Script
# This script deploys the media-search edge function to Supabase

echo "🚀 Supabase Edge Function Deployment"
echo "======================================"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found!"
    echo ""
    echo "Please install it first:"
    echo "  npm install -g supabase"
    echo ""
    echo "Or with homebrew:"
    echo "  brew install supabase"
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Login check
echo "🔐 Checking Supabase login status..."
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase CLI"
    echo ""
    echo "Please login first:"
    echo "  supabase login"
    exit 1
fi

echo "✅ Logged in to Supabase"
echo ""

# Link project
echo "🔗 Linking to Supabase project..."
supabase link --project-ref ylefihvjlyzabhvgdnoe

if [ $? -ne 0 ]; then
    echo "❌ Failed to link project"
    exit 1
fi

echo "✅ Project linked"
echo ""

# Deploy edge function
echo "📦 Deploying media-search edge function..."
supabase functions deploy media-search --no-verify-jwt

if [ $? -ne 0 ]; then
    echo "❌ Failed to deploy function"
    exit 1
fi

echo "✅ Function deployed successfully!"
echo ""

# Set environment variables
# SECURITY: never hard-code secrets here. The previously-committed TMDB key was
# exposed in git history and MUST be rotated at
#   https://www.themoviedb.org/settings/api
# Then provide the new key via your environment before running this script:
#   export TMDB_API_KEY=your_new_key      (and optionally FANART_API_KEY=...)
echo "🔧 Setting environment variables..."
if [ -z "$TMDB_API_KEY" ]; then
    echo "⚠️  TMDB_API_KEY not set in environment — skipping (movies/series enrichment + poster fallback won't work until set)."
    echo "    Run:  export TMDB_API_KEY=your_new_key  &&  ./deploy-edge-function.sh"
else
    supabase secrets set TMDB_API_KEY="$TMDB_API_KEY"
    echo "✅ TMDB_API_KEY set"
fi
if [ -n "$FANART_API_KEY" ]; then
    supabase secrets set FANART_API_KEY="$FANART_API_KEY"
    echo "✅ FANART_API_KEY set"
fi
echo ""

echo "🎉 Deployment complete!"
echo ""
echo "Test the function:"
echo "  curl 'https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search?q=naruto&type=anime'"
echo ""
echo "Your edge function is now live at:"
echo "  https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search"