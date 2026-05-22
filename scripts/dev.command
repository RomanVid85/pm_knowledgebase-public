#!/bin/bash
# Double-click launcher for the local dev environment.
#
# Starts Next.js (http://localhost:3001) and the Inngest dev server
# (http://localhost:8288) in one terminal window with prefixed log output.
#
# To use:
#   1. Right-click in Finder → Open (first time only — macOS asks to confirm)
#   2. Subsequent runs: double-click
#   3. Close the Terminal window (Cmd+W) to stop both processes.
#
# To pin to your Dock:
#   - Drag this file to your Desktop (or anywhere) for a Finder icon.
#   - For a Dock icon, see scripts/README.md for the Automator wrap.

set -e

# cd to the project root regardless of where this is launched from.
cd "$(dirname "$0")/.."

# Ensure local Supabase is running (.env.local points at localhost:54321).
if ! command -v supabase >/dev/null 2>&1; then
  echo "✗ Supabase CLI not found. Install: brew install supabase/tap/supabase"
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "→ Local Supabase not running. Starting it..."
  supabase start
fi

# Run both dev processes concurrently. Ctrl+C or closing the window stops both.
echo "→ Starting Next.js (port 3001) and Inngest dev server (port 8288)..."
echo "  Next.js:           http://localhost:3001"
echo "  Inngest dashboard: http://localhost:8288"
echo
exec npm run dev:all
