// functions/api/upvote-server.js
// Cloudflare Pages Function (native Web APIs, zero dependencies).
// Route: /api/upvote-server   (same-origin with the site, so no CORS headers)
//
// Environment variables (Cloudflare Pages -> Settings -> Environment variables):
//   DATABASE_URL   postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require
//   UPVOTE_SECRET  random string, 16+ chars. Used to HMAC IP addresses.
//                  POST fails closed (503) if it is missing or too short.
//
// Schema: see upvotes.sql
//
// API
//   GET  ?id=<post>&voterToken=<token>  -> 200 { id, count, hasVoted }
//   POST { id, voterToken, title }      -> 200 { id, count, hasVoted: true, status: 'voted' | 'duplicate' }
//                                          429 { error: 'rate_limited', count }
//   Other failures: 400 / 403 / 413 / 415 / 503 with { error }.

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const LIMITS = {
  // Per-IP caps per clock hour (UTC). Enforced atomically by counter rows in
  // ip_quota, so concurrent requests cannot overshoot. Because the window is a
  // fixed clock hour, a burst straddling the hour boundary can get up to 2x.
  perPostPerHour: 20, // distinct voter tokens per IP per post
  perIpPerHour: 60, // across all posts (also bounds junk post IDs per IP)
  quotaRetentionHours: 2, // ip_quota rows older than this are deleted
  scrubProbability: 0.02, // fraction of successful votes that trigger cleanup
  dbTimeoutMs: 5000,
  maxBodyBytes: 2048,
};

const POST_ID_MAX = 200;
// Segments start alphanumeric, so "." / ".." segments are impossible.
const POST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*){0,5}$/;
const VOTER_TOKEN_RE = /^vtr_[a-f0-9]{32}$/;

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// One atomic statement:
//   gate (already voted?) -> per-post quota -> all-posts quota -> insert voter
//   -> bump counter
// The quota steps are "INSERT ... ON CONFLICT DO UPDATE ... WHERE n < cap":
// Postgres locks the quota row and re-checks the cap against its latest
// version, so racing requests are serialized and the cap is exact.
// $1 post_id, $2 voter_token, $3 ip_hash, $4 per-post cap, $5 per-IP cap
// Returns one row: status ('voted' | 'duplicate' | 'capped') and the count.
const VOTE_SQL = `
WITH gate AS (
  SELECT EXISTS (
    SELECT 1 FROM article_voters WHERE post_id = $1 AND voter_token = $2
  ) AS dup
),
q_post AS (
  INSERT INTO ip_quota (ip_hash, scope, window_start, n)
  SELECT $3, $1, date_trunc('hour', NOW(), 'UTC'), 1 FROM gate WHERE NOT gate.dup
  ON CONFLICT (ip_hash, scope, window_start)
    DO UPDATE SET n = ip_quota.n + 1 WHERE ip_quota.n < $4
  RETURNING 1
),
q_all AS (
  INSERT INTO ip_quota (ip_hash, scope, window_start, n)
  SELECT $3, '*', date_trunc('hour', NOW(), 'UTC'), 1 FROM q_post
  ON CONFLICT (ip_hash, scope, window_start)
    DO UPDATE SET n = ip_quota.n + 1 WHERE ip_quota.n < $5
  RETURNING 1
),
ins AS (
  INSERT INTO article_voters (post_id, voter_token)
  SELECT $1, $2 FROM q_all
  ON CONFLICT (post_id, voter_token) DO NOTHING
  RETURNING 1
),
bump AS (
  INSERT INTO article_upvotes (id, count, updated_at)
  SELECT $1, 1, NOW() FROM ins
  ON CONFLICT (id) DO UPDATE
    SET count = article_upvotes.count + 1, updated_at = NOW()
  RETURNING count
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM ins) THEN 'voted'
    -- Not inserted: already voted, or both quotas passed but ON CONFLICT
    -- skipped the row (two requests racing on the same token).
    WHEN (SELECT dup FROM gate) OR EXISTS (SELECT 1 FROM q_all) THEN 'duplicate'
    ELSE 'capped'
  END AS status,
  COALESCE(
    (SELECT count FROM bump),
    (SELECT count FROM article_upvotes WHERE id = $1),
    0
  )::int AS count
`;

// $1 post_id, $2 voter_token ('' when unknown). Integers only, no booleans, so
// the result does not depend on how Neon encodes bool values over HTTP.
const STATE_SQL = `
SELECT
  COALESCE((SELECT count FROM article_upvotes WHERE id = $1), 0)::int AS count,
  (EXISTS (
    SELECT 1 FROM article_voters WHERE post_id = $1 AND voter_token = $2
  ))::int AS has_voted
`;

const SCRUB_SQL = `
DELETE FROM ip_quota
WHERE window_start < date_trunc('hour', NOW(), 'UTC') - INTERVAL '${Math.floor(LIMITS.quotaRetentionHours)} hours'
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

// Accepts "posts/hello-world", "/posts/hello-world/" etc. Returns the
// normalized ID or null when invalid.
function normalizePostId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!id || id.length > POST_ID_MAX || !POST_ID_RE.test(id)) return null;
  return id;
}

// Collapse an IP to the unit we rate-limit on: IPv4 as-is, IPv6 as its /64
// (a single subscriber normally owns a whole /64, so per-address limits would
// be trivially bypassed).
function ipKey(ip) {
  if (!ip) return 'unknown';
  const v = ip.trim().toLowerCase();
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!v.includes(':')) return v;
  const halves = v.split('::');
  if (halves.length > 2) return v;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups = left;
  if (halves.length === 2) {
    const missing = Math.max(8 - left.length - right.length, 0);
    groups = [...left, ...Array(missing).fill('0'), ...right];
  }
  return 'v6:' + groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':');
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Keyed hash of the (normalized) client IP. Only used as the ip_quota key and
// never stored next to a vote. Not reversible without the secret.
async function getIpHash(request, secret) {
  // cf-connecting-ip is always set by Cloudflare. We deliberately do not fall
  // back to x-forwarded-for, which a client could spoof to dodge the caps.
  const ip = ipKey(request.headers.get('cf-connecting-ip'));
  return (await hmacHex(secret, 'ip:' + ip)).slice(0, 32);
}

// Neon SQL-over-HTTP. Throws on any failure (the caller maps that to a 503).
function neonEndpoint(databaseUrl) {
  const u = new URL(databaseUrl.replace(/^postgres(?:ql)?:\/\//, 'https://'));
  // The HTTP endpoint is served on the direct (non "-pooler") hostname.
  return `https://${u.hostname.replace('-pooler', '')}/sql`;
}

async function query(env, sql, params) {
  const res = await fetch(neonEndpoint(env.DATABASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': env.DATABASE_URL,
    },
    body: JSON.stringify({ query: sql, params }),
    signal: AbortSignal.timeout(LIMITS.dbTimeoutMs),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Neon HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }

  const data = await res.json();
  if (!data || !Array.isArray(data.rows)) throw new Error('Unexpected Neon response');
  return data.rows;
}

// Neon may return ints as numbers or as text depending on its output mode.
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGet(context, url) {
  const { env } = context;
  if (!env.DATABASE_URL) {
    console.error('upvote: DATABASE_URL is not configured');
    return json({ error: 'Service unavailable' }, 503);
  }

  const postId = normalizePostId(url.searchParams.get('id'));
  if (!postId) return json({ error: 'Valid post ID required' }, 400);

  // The token is optional on GET; an unknown/invalid one just means hasVoted=false.
  const rawToken = url.searchParams.get('voterToken') || '';
  const voterToken = VOTER_TOKEN_RE.test(rawToken) ? rawToken : '';

  try {
    const rows = await query(env, STATE_SQL, [postId, voterToken]);
    const row = rows[0] || {};
    return json({
      id: postId,
      count: toInt(row.count),
      hasVoted: toInt(row.has_voted) === 1,
    });
  } catch (err) {
    console.error('upvote GET failed:', err.message);
    return json({ error: 'Service unavailable' }, 503);
  }
}

async function handlePost(context, request, url) {
  const { env } = context;

  // Browsers always send Origin on cross-origin POSTs. Together with the
  // Content-Type check below (which forces a CORS preflight, and we send no
  // CORS headers) this stops other sites from casting votes through a
  // visitor's browser and burning that visitor's IP quota.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  if (!env.DATABASE_URL) {
    console.error('upvote: DATABASE_URL is not configured');
    return json({ error: 'Service unavailable' }, 503);
  }
  const secret = env.UPVOTE_SECRET;
  if (!secret || secret.length < 16) {
    console.error('upvote: UPVOTE_SECRET is missing or shorter than 16 characters');
    return json({ error: 'Service unavailable' }, 503);
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > LIMITS.maxBodyBytes) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Honeypot: the page pre-fills this field and the client clears it on real
  // user interaction, so a non-empty value means no human interaction.
  if (body.title) return json({ error: 'Request rejected' }, 400);

  const postId = normalizePostId(body.id);
  if (!postId) return json({ error: 'Valid post ID required' }, 400);

  const voterToken = typeof body.voterToken === 'string' ? body.voterToken : '';
  if (!VOTER_TOKEN_RE.test(voterToken)) return json({ error: 'Valid voter token required' }, 400);

  try {
    const ipHash = await getIpHash(request, secret);
    const rows = await query(env, VOTE_SQL, [
      postId,
      voterToken,
      ipHash,
      LIMITS.perPostPerHour,
      LIMITS.perIpPerHour,
    ]);
    const row = rows[0];
    if (!row) throw new Error('Vote statement returned no row');

    const status = String(row.status);
    const count = toInt(row.count);

    if (status === 'voted' || status === 'duplicate') {
      if (status === 'voted' && Math.random() < LIMITS.scrubProbability) {
        // Best-effort cleanup of expired quota rows (hashed IPs).
        const scrub = query(env, SCRUB_SQL, []).catch((e) =>
          console.warn('upvote scrub failed:', e.message)
        );
        if (typeof context.waitUntil === 'function') context.waitUntil(scrub);
      }
      return json({ id: postId, count, hasVoted: true, status });
    }

    if (status === 'capped') {
      // The quota resets at the top of the next UTC hour.
      const retryAfter = Math.max(1, Math.ceil((3600000 - (Date.now() % 3600000)) / 1000));
      return json({ error: 'rate_limited', count }, 429, { 'Retry-After': String(retryAfter) });
    }

    throw new Error(`Unexpected vote status: ${status}`);
  } catch (err) {
    console.error('upvote POST failed:', err.message);
    return json({ error: 'Service unavailable' }, 503);
  }
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'GET') return handleGet(context, url);
  if (request.method === 'POST') return handlePost(context, request, url);

  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
}