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
# SECURITY: JWT verification is ON. The previous --no-verify-jwt deploy made this
# a public, unauthenticated proxy that holds the service-role key — anyone could
# write to media_metadata and burn the TMDB quota. The client sends its session
# token (lib/edge-function.ts mediaSearchGet), so signed-in users are unaffected.
# --use-api bundles server-side, so Docker doesn't need to be running. The
# function's settings (verify_jwt = true) come from supabase/config.toml.
echo "📦 Deploying media-search edge function..."
supabase functions deploy media-search --use-api

if [ $? -ne 0 ]; then
    echo "❌ Failed to deploy function"
    exit 1
fi

echo "✅ Function deployed successfully!"
echo ""

# Set environment variables. Each secret is set ONLY when its variable is
# exported in this shell; an unset one is left exactly as it is on the server
# (never cleared). Values are never echoed.
# SECURITY: never hard-code secrets here. The previously-committed TMDB key is
# still readable in git history; not rotating it is an accepted risk (decided
# 2026-08-20, worst case is free-tier quota). Provide the key via your
# environment before running this script:
#   export TMDB_API_KEY=your_new_key      (and optionally FANART_API_KEY=...)
echo "🔧 Setting environment variables..."
if [ -z "$TMDB_API_KEY" ]; then
    echo "ℹ️  TMDB_API_KEY not exported here, so the server's value is left unchanged (check: supabase secrets list)."
    echo "    To change it:  export TMDB_API_KEY=your_new_key  &&  ./deploy-edge-function.sh"
else
    supabase secrets set TMDB_API_KEY="$TMDB_API_KEY"
    echo "✅ TMDB_API_KEY set"
fi
if [ -n "$FANART_API_KEY" ]; then
    supabase secrets set FANART_API_KEY="$FANART_API_KEY"
    echo "✅ FANART_API_KEY set"
fi
# Cover copy (action=cover_copy) is allow-listed: only these user ids may copy
# covers into Storage (comma-separated). Unset on the server = nobody can.
#   export COVER_COPY_USERS=<your user id>
if [ -n "$COVER_COPY_USERS" ]; then
    supabase secrets set COVER_COPY_USERS="$COVER_COPY_USERS"
    echo "✅ COVER_COPY_USERS set"
else
    echo "ℹ️  COVER_COPY_USERS not exported here, so the server's value is left unchanged (if it was never set, cover copy is off for everyone)."
fi
# Restrict CORS to your own origins. Comma-separated; unset falls back to '*'.
#   export ALLOWED_ORIGINS="https://your-app.example,http://localhost:8080"
if [ -n "$ALLOWED_ORIGINS" ]; then
    supabase secrets set ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
    echo "✅ ALLOWED_ORIGINS set"
else
    echo "ℹ️  ALLOWED_ORIGINS not exported here, so the server's value is left unchanged (if it was never set, CORS is '*')."
fi
echo ""

echo "🎉 Deployment complete!"
echo ""
# The printed curl is unauthenticated, so verify_jwt answers 401. Add
#   -H "Authorization: Bearer <a signed-in user's access token>"
# to get results.
echo "Test the function:"
echo "  curl 'https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search?q=naruto&type=anime'"
echo ""
echo "Your edge function is now live at:"
echo "  https://ylefihvjlyzabhvgdnoe.supabase.co/functions/v1/media-search"