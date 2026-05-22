# Project scripts

## `dev.command` — one-click local dev launcher

Double-click `dev.command` in Finder to start the entire local dev stack:

- **Local Supabase** (auto-started if not already running)
- **Next.js dev server** → http://localhost:3001
- **Inngest dev server + dashboard** → http://localhost:8288

A Terminal window opens with prefixed logs from both processes. Close the window (or hit `Ctrl+C`) to stop everything.

### First run

macOS Gatekeeper may block the script because it isn't code-signed. The first time:

1. Right-click `dev.command` in Finder → **Open**
2. Confirm "Open" in the dialog
3. After this, double-click works normally.

### Pin to the Dock as a real `.app` (optional polish)

The default `.command` icon is a generic Terminal icon. For a proper Dock-able app with a custom icon, wrap it via Automator (~5 min):

1. Open **Automator.app** (Spotlight: `Cmd+Space` → "Automator")
2. **New Document → Application**
3. In the actions sidebar, find **Utilities → Run Shell Script** and drag it to the workflow area
4. Set "Pass input" to **as arguments** (or leave default)
5. Replace the script body with:
   ```bash
   /Users/<your-username>/pm-knowledge-base/scripts/dev.command
   ```
   *(If the path has spaces, wrap it in quotes.)*
6. **File → Save** as `PM-KB Dev.app` to `~/Applications` (or anywhere)
7. **Drag the `.app` to your Dock** for one-click access
8. *(Optional)* For a custom icon: right-click the `.app` → **Get Info** → drag any image file onto the small icon at the top-left of the Info window

The `.app` will live on your machine only (not in the repo). Anyone else cloning the repo can either use `dev.command` directly or build their own Automator wrap.
