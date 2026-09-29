// Local dev server for the `media-search` edge function: no Docker, no Supabase CLI.
//
//   npm run edge:dev            → http://127.0.0.1:8787   (EDGE_DEV_PORT to change)
//
// Runs the REAL supabase/functions/media-search/index.ts in the REAL Deno runtime
// (fetched through npm as `deno`, so no brew install), with four dev-only shims:
//   1. env: reads .env via --env-file (never printed). The platform's
//      SUPABASE_URL is taken from VITE_SUPABASE_URL when not set.
//   2. Deno.serve is pinned to 127.0.0.1 (never exposed on the network: this
//      process holds the service-role key).
//   3. verify_jwt emulation: the hosted gateway rejects requests without a valid
//      JWT before the function runs. There is no gateway here, so every request's
//      bearer token is checked against Supabase Auth (/auth/v1/user) — or must be
//      the service-role key itself (maintenance scripts) — before the function
//      sees it. Verified tokens are cached for 60 s.
//   4. cache writes OFF: EDGE_CACHE_WRITES=0, so the function never writes
//      media_metadata or media_source_meta. Opt in with EDGE_DEV_CACHE_WRITES=1.
//
// IMPORTANT: this is local CODE against the PRODUCTION database, often from a
// network that blocks some sources, so its answers can be thinner than the
// deployed function's. Reads are real; writes stay off unless you opt in, and
// then they go to prod with the service role (merged, never downgrading a row).
//
// Point the app at it (dev builds only; production ignores it):
//   .env.local  →  VITE_MEDIA_SEARCH_URL=http://127.0.0.1:8787

const env = (k: string) => Deno.env.get(k) ?? '';

if (!env('SUPABASE_URL') && env('VITE_SUPABASE_URL')) Deno.env.set('SUPABASE_URL', env('VITE_SUPABASE_URL'));
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
const PORT = Number(env('EDGE_DEV_PORT') || 8787);
// Forced either way, so a stray EDGE_CACHE_WRITES in .env can't turn writes on.
const CACHE_WRITES = env('EDGE_DEV_CACHE_WRITES') === '1';
Deno.env.set('EDGE_CACHE_WRITES', CACHE_WRITES ? '1' : '0');

const missing = [
  !SUPABASE_URL && 'VITE_SUPABASE_URL',
  !SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  !ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean);
if (missing.length) {
  console.error(`edge:dev needs ${missing.join(', ')} in .env (values are never printed).`);
  Deno.exit(1);
}

// ---- verify_jwt emulation --------------------------------------------------
const verified = new Map<string, number>(); // token -> expiry (ms)
async function tokenIsValid(token: string): Promise<boolean> {
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  const until = verified.get(token);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    verified.set(token, Date.now() + 60_000);
    return true;
  } catch {
    return false;
  }
}

type Handler = (req: Request) => Response | Promise<Response>;

function describe(req: Request): string {
  const u = new URL(req.url);
  const p = u.searchParams;
  const bits = ['action', 'source', 'type', 'q', 'id', 'refresh']
    .filter((k) => p.has(k))
    .map((k) => `${k}=${k === 'q' ? JSON.stringify(p.get(k)) : p.get(k)}`);
  return `${req.method} ${bits.join(' ') || u.pathname}`;
}

// ---- pin Deno.serve to localhost and wrap the function's handler -----------
const realServe = Deno.serve.bind(Deno);
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  value: (handlerOrOpts: unknown, maybeHandler?: unknown) => {
    const inner = (typeof handlerOrOpts === 'function' ? handlerOrOpts : maybeHandler) as Handler;
    const wrapped: Handler = async (req) => {
      const started = Date.now();
      if (req.method !== 'OPTIONS') {
        const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (!(await tokenIsValid(token))) {
          console.log(`401 ${describe(req)} (no valid JWT — the hosted gateway would reject this too)`);
          return new Response(JSON.stringify({ code: 401, message: 'Invalid JWT' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
      const res = await inner(req);
      console.log(`${res.status} ${describe(req)} ${Date.now() - started}ms`);
      return res;
    };
    return realServe({
      hostname: '127.0.0.1',
      port: PORT,
      onListen: ({ hostname, port }) => {
        console.log(`media-search (local) → http://${hostname}:${port}`);
        console.log('  code: supabase/functions/media-search/index.ts · data: PRODUCTION (service role)');
        console.log(CACHE_WRITES
          ? '  cache: WRITES ON (EDGE_DEV_CACHE_WRITES=1) → media_metadata / media_source_meta in prod'
          : '  cache: read-only (set EDGE_DEV_CACHE_WRITES=1 to write the prod cache)');
        console.log('  app:  set VITE_MEDIA_SEARCH_URL=http://127.0.0.1:' + port + ' in .env.local, then npm run dev');
      },
    }, wrapped);
  },
});

await import('../../supabase/functions/media-search/index.ts');
