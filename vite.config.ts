import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Settings → About shows exactly which build is running: package.json's version
// (bumped on every push to main), the commit (Netlify's COMMIT_REF, else local git)
// and when it was built.
const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const APP_COMMIT = (() => {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
})();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      // The app registers the SW itself (src/lib/app-update.ts: update checks + a
      // safe reload); the injected registerSW.js only registered it and never updated.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'NoteHaven',
        short_name: 'NoteHaven',
        description: 'Your personal productivity hub for notes, tasks, media tracking, and more',
        // Match the app's dark-first Aurora canvas. The old #4B5D7A predated the
        // redesign, and background_color: #ffffff flashed a white splash on every
        // installed launch of a dark app.
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // The Tachimanga import worker (sql.js + jszip, ~147 KB) runs only when he
        // imports a backup, so installs don't download it (its .wasm isn't matched above).
        globIgnores: ['**/parse.worker-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
          // No Supabase runtime cache (UX-35). It kept every API GET — private rows,
          // /auth/v1/user, Vault files — in Cache Storage after logout, keyed by URL
          // only, and its 10 s NetworkFirst timeout turned a slow network into a
          // stall followed by stale data. The app is online-first; failing fast is
          // better. App.tsx deletes the old 'supabase-api-cache' on startup.
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Name the big shared vendors + the heavy page-only leaves. Everything
        // else is left for Rollup to auto-place: page-specific libs land in the
        // lazy route chunk that uses them, widely-used libs (radix) become a
        // shared chunk. react-vendor is kept a self-contained leaf (react + dom
        // + router + their deps) so no chunk imports back into it — avoids the
        // circular-chunk warning that aggressive splitting causes.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // clsx (behind cn()) is also a recharts dependency. Left to Rollup it was
          // hoisted INTO the forced "charts" chunk, so the entry imported clsx from
          // there and all of recharts + d3 (~108 kB gz) was modulepreloaded on every
          // cold load, /login included (audit F-X01). Pin these tiny, app-wide utils
          // to react-vendor, which the entry loads anyway.
          if (/[\\/]node_modules[\\/](clsx|tailwind-merge)[\\/]/.test(id)) return "react-vendor";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "editor";
          // Language grammars are imported on demand by CodeEditor. Leaving them
          // out of the forced "codemirror" chunk lets Rollup emit one small lazy
          // chunk per language instead of bundling all 18 into the core editor.
          if (id.includes("@codemirror/lang-") || id.includes("@codemirror/legacy-modes")) return undefined;
          if (id.includes("@lezer/")) return undefined;
          if (id.includes("@codemirror") || /[\\/]codemirror[\\/]/.test(id)) return "codemirror";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory")) return "charts";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query";
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|history)[\\/]/.test(id)) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
}));
