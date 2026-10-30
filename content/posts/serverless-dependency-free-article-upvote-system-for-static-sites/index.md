+++
draft = false # Set this to false when you're ready to publish the article to production
slug = "serverless-dependency-free-article-upvote-system-for-static-sites"
type = "post"
in_search_index = true
title = "Serverless, Dependency-Free Article Upvote System for Static Sites"
description = "A clean upvoting system for articles for static sites using Serverless Functions for the backend, and Neon for the database."
date = 2026-10-28
# updated = 2026-10-28

[extra]
toc = true
featured = false
license = "CC-BY-SA-4.0"
wrap_code = false
katex = false
mermaid = false
upvote = true # Set to false to disable upvotes on this article
# uid = "posts/serverless-dependency-free-article-upvote-system-for-static-sites" # Optional: Set to original ID if you rename this post's slug in the future to preserve upvotes
# og_preview_img = "/images/sample-image.jpeg" # Uncomment to specify a custom OG preview image, otherwise the build script will auto-generate one.
# cover_image = "/images/sample-image.jpeg"

[taxonomies]
post_tags = ["post","upvote","zola","serverless"]
+++

*Anonymous per-device votes, one serverless function and one Postgres database. No framework required, no npm packages.*

Static sites are fast, cheap and hard to break, but the moment you want a live upvote counter you need somewhere to keep state. This post walks through a small upvote system I built for my blog, which is a static site on [Cloudflare Pages](https://pages.cloudflare.com/). Nothing in it depends on a particular site generator: the page side is one HTML snippet, one script and some CSS, and the server side is one function plus three Postgres tables. It was inspired by [Herman’s Bear Blog](https://herman.bearblog.dev/) and [Betaveros’s deep-dive “That Accursed Upvote Button”](https://betaveros.bearblog.dev/that-accursed-upvote-button/), which are both worth reading for the tradeoffs involved.

By the end you will have:

- three tables on [Neon](https://neon.com/) (any Postgres 12 or newer works),
- one serverless function (about 330 lines of plain JavaScript, including comments),
- one HTML snippet, one small client script and a bit of CSS.

The code in this post is complete. File names are only suggestions, so put things wherever your project layout prefers and adjust the paths in the `<script>` tag and the `data-api` attribute to match.

**What you need:** a static site (any generator, or hand-written HTML) hosted somewhere that can run a serverless function on the same domain, and a free Neon account. The function written in this article is specific to Cloudflare Pages Functions, but can be adapted to other platforms.

## How it fits together

```text
Browser
  - anonymous voter token kept in localStorage
  - optimistic UI, rolled back if the server says no
        |
        |  fetch() GET / POST (same origin)
        v
Serverless function  /api/upvote-server
  - validates input, checks Origin and Content-Type
  - enforces per-IP hourly caps atomically
  - one SQL statement per vote
        |
        |  HTTPS (Neon SQL over HTTP)
        v
Postgres (Neon)
  - article_upvotes: one running count per post
  - article_voters:  one row per (post, device)
  - ip_quota:        short-lived per-IP hourly counters
```

### Design goals

1. **No dependencies in the shipped code.** Plain JavaScript using `fetch()`, `crypto.subtle` and `localStorage`. (You may still want [Wrangler](https://developers.cloudflare.com/workers/wrangler/) as a local dev tool, covered below.)
2. **Fail visibly, never silently.** If the API is down, the count is hidden instead of showing a made-up number, and a failed vote is rolled back with a short message. The reader is never locked out.
3. **Per-device votes, not per-network.** One vote must not lock out everyone behind the same router.
4. **Survive URL changes.** Renaming a post must not orphan its votes.
5. **The count can’t drift.** The aggregate and the voter rows change in one atomic statement.

## Design decisions worth explaining

### 1. Identify voters with a token, not an IP address

The obvious first approach is to store the visitor’s IP and refuse a second vote from it. The problem is NAT: every device behind one router, from a family’s phones to hundreds of people in an office or on a campus, presents the same public IP. One upvote then locks out the whole network.

Instead, the browser generates a random anonymous `voter_token` and keeps it in `localStorage`. The database enforces one vote per `(post_id, voter_token)` pair, so a laptop and a phone on the same Wi-Fi can each vote once.

The IP is not thrown away, but it is used for one narrow purpose: generous hourly caps as a fallback against scripted voting. The server turns it into a keyed hash and uses that only as the key of a short-lived counter row. The hash is never stored next to a vote, and the counter rows are deleted after a couple of hours. The caps are deliberately high, so a shared network can still have many legitimate voters.

The tradeoff is that clearing site data gives you a fresh identity. For a blog upvote button I think that is acceptable.

### 2. Don’t sign the vote request

An earlier version of mine handed out a short-lived HMAC token on `GET` and verified it on `POST`, so a vote couldn’t be redirected to another post. It looked rigorous, and it protected nothing: anyone scripting the endpoint can simply request a token for whichever post they like. It also made the system more fragile, because a tab left open for an hour had an expired token, and a click that landed before the token arrived was sent without one.

I removed it. What protects the endpoint now is boring and checkable: strict validation of every input, an `Origin` check plus a JSON-only content type (which stop *other websites* from casting votes through a visitor’s browser), and per-IP caps. If you later need real bot resistance, put a challenge such as Cloudflare Turnstile in front of the `POST` and verify its token on the server before touching the database.

### 3. Enforce the caps with counters, not by counting rows

The natural way to cap votes per IP is to count that IP’s recent rows in the votes table and insert only if the count is under the limit. Under concurrency that check is unreliable: every request reads the same snapshot, so a burst all passes the check at once. In a test with 100 simultaneous requests from one IP against a cap of 20, this approach let 50 through.

The fix is to move the check onto a row that Postgres locks. Each IP gets a counter row per hour, and the vote runs `INSERT ... ON CONFLICT DO UPDATE ... WHERE n < cap`. Concurrent requests queue on that row and each one re-checks the cap against the latest value. The same test then lets through exactly 20.

Two honest tradeoffs: the window is a fixed clock hour, so a burst that straddles the hour boundary can get up to twice the cap, and an attempt that is refused still uses up a little quota. Both are harmless for this purpose.

### 4. Only trust the server about whether you voted

An optimistic UI is nice, but it creates a nasty failure mode. Suppose the click handler writes `upvoted = true` to `localStorage` and the request then fails. On every later visit the button is stuck in its voted state while the count shows `0`.

The rules I use: `localStorage` is only a cache for the first paint. It is written only after the server confirms the vote, and it is deleted whenever a later `GET` says the server has no vote. If the API is merely unreachable, the cache is left alone, so a returning voter still sees their vote. The count stays hidden until the server has reported it, and no “+1” is shown while the real number is unknown. A failed vote is rolled back and the button shows the failure for a few seconds.

### 5. Use aria-disabled, not disabled

A native `disabled` button is removed from the tab order and, in several browsers, stops firing mouse events, so hover feedback such as a tooltip silently stops working. `aria-disabled="true"` plus a CSS class keeps the button focusable and hoverable, and screen readers still announce it as unavailable. The click handler simply returns early. The same state is used for the few seconds after a failed vote, so the button can’t be hammered while the failure message is showing.

## Step 1: Create the database tables

Create a free project in Neon, open **SQL Editor** and run:

```sql
-- One running total per post. Reads are a single primary-key lookup.
CREATE TABLE IF NOT EXISTS article_upvotes (
    id          VARCHAR(200) PRIMARY KEY,
    count       INTEGER      NOT NULL DEFAULT 0 CHECK (count >= 0),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per (post, anonymous device token). The primary key is what makes
-- a vote idempotent.
CREATE TABLE IF NOT EXISTS article_voters (
    post_id      VARCHAR(200) NOT NULL,
    voter_token  VARCHAR(40)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, voter_token)
);

-- Per-IP hourly counters used for the rate caps, one row per
-- (hashed IP, scope, UTC hour). scope is a post id, or '*' for the
-- all-posts cap.
CREATE TABLE IF NOT EXISTS ip_quota (
    ip_hash       VARCHAR(64)  NOT NULL,
    scope         VARCHAR(200) NOT NULL,
    window_start  TIMESTAMPTZ  NOT NULL,
    n             INTEGER      NOT NULL DEFAULT 0,
    PRIMARY KEY (ip_hash, scope, window_start)
);
```

How the pieces work together:

- **`article_upvotes`** holds the number you display.
- **`article_voters`** holds one row per vote. Its primary key is what stops a device from voting twice on the same post. No IP-derived data lives here.
- **`ip_quota`** holds only a keyed hash and a count per hour. The function deletes rows older than two hours, so these hashes never pile up.
- Because the count lives in a separate table from the votes, the two have to change together. The function in Step 2 does that in a single SQL statement, so they can’t drift apart.
- The column sizes match the validation in the function (post IDs up to 200 characters, tokens of exactly 36). The function uses the three-argument form of `date_trunc`, which needs Postgres 12 or newer.

Then copy your connection string from the Neon dashboard (**Connect**, then copy the connection string). It looks like this:

```text
postgresql://USER:PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

## Step 2: The serverless function

On Cloudflare Pages, any file under a top-level `functions/` directory (at the root of the repository, next to your site’s source) is deployed as a function, and the file path becomes the route. Saving this as `functions/api/upvote-server.js` serves it at `/api/upvote-server`.

```javascript
// functions/api/upvote-server.js
// Cloudflare Pages Function (native Web APIs, zero dependencies).
// Route: /api/upvote-server   (same origin as the site, so no CORS headers)
//
// Environment variables (Pages -> Settings -> Variables and Secrets):
//   DATABASE_URL   postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require
//   UPVOTE_SECRET  random string, 16+ chars. Used to HMAC IP addresses.
//                  POST fails closed (503) if it is missing or too short.
//
// Tables: article_upvotes, article_voters, ip_quota (see Step 1)
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
```

A few notes on this file:

- **Status codes.** `200` means voted or already voted, `400` invalid input, `403` a request from another origin, `413` body too large, `415` wrong content type, `429` hourly cap reached, and `503` a database error or missing configuration. The client treats `429` and every other non-success as a failed vote.
- **One statement, three tables.** Data-modifying CTEs in Postgres all run within one statement, which is atomic. `gate` checks whether this device already voted, `q_post` and `q_all` take a unit from the two hourly quotas, `ins` records the vote only if both quotas allowed it, and `bump` increments the aggregate only if `ins` actually inserted a row. A repeated vote or a concurrent duplicate inserts nothing and changes nothing, so the count and the voter rows can’t disagree.
- **Input is validated before it touches SQL.** All values are bound parameters, the post ID is restricted to a conservative character set (letters, digits, `._~-` and up to six `/`-separated segments), and the voter token must match its exact format.
- **Why SQL over HTTP?** A Worker can’t keep a pooled TCP connection around between requests, and an HTTP call is one round trip with nothing to open or close. It is the transport Neon’s own serverless driver uses in HTTP mode. If you would rather depend on a supported client, use `@neondatabase/serverless`; the SQL stays the same. The code strips `-pooler` from the host name, which is what worked for me.
- **The client IP.** `cf-connecting-ip` is the header Cloudflare sets with the visitor’s address. On another host, use whichever header your platform sets itself, and never fall back to one a client can send, because a spoofable header lets people dodge the caps. IPv6 addresses are collapsed to their /64, since one subscriber usually owns a whole /64.
- **The secret.** `UPVOTE_SECRET` only keys the IP hash. Rotating it resets the current quota counts and nothing else. `GET` works without it, while `POST` returns `503` until it is set to at least 16 characters.
- **Cleanup.** About 2% of successful votes trigger a best-effort delete of expired `ip_quota` rows, run with `waitUntil` so it never delays the response. Votes and counts are never deleted.
- **Tuning.** The caps are constants at the top of the file: 20 votes per IP per post per hour, and 60 per IP across all posts. If a post is shared inside a large office or campus, raise them.

## Step 3: The button

### The markup

This is plain HTML, so it works in any template engine or static page. Only the `data-id` and the honeypot value need to come from your template.

```html
<div class="upvote-container">
  <form class="upvote-form" id="upvote-form" data-id="posts/hello-world" data-api="/api/upvote-server" onsubmit="return false;">
    <!-- Honeypot: pre-filled with any non-empty text, hidden by CSS, and cleared
         by the script on the first real mouse, touch or key event. -->
    <input type="text" name="title" value="Hello, world" class="upvote-honeypot" tabindex="-1" autocomplete="off" aria-hidden="true">

    <button type="button" class="upvote-button" id="upvote-btn" aria-label="Upvote this article" data-title="Upvote this article">
      <span class="upvote-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>
        </svg>
      </span>
      <span class="upvote-label">Upvote</span>
      <span class="upvote-count" id="upvote-count" aria-live="polite" data-state="loading"></span>
    </button>

    <!-- Screen-reader-only announcements for votes and errors -->
    <span class="upvote-status" role="status"></span>
  </form>
</div>

<script src="/js/upvote-client.js" defer></script>
```

What each part is for:

- **`data-id`** is the post’s vote ID, and **`data-api`** is the function’s URL. Both are read by the script.
- **The honeypot** is a text field a human never sees. The page ships it pre-filled, the script empties it on the first genuine mouse, touch or key event, and the server rejects any vote that arrives with it still filled. That catches scripts that replay the form without interacting. It is a speed bump, not protection. The field name is arbitrary (here it is called `title`), but the markup, the script and the function must all agree on it, so change them together.
- **`data-state="loading"`** on the count starts it invisible, with its space reserved, so there is no flash of a wrong number.
- **The `upvote-label` span** must stay: the script puts failure messages there for a few seconds.
- **`data-title` and the `.custom-tooltip` lookup** in the script are hooks for a custom tooltip component. If you use a plain `title` attribute or no tooltip, you can delete them.

### The client script

Save this as `static/js/upvote-client.js`, or wherever your site serves scripts from.

```javascript
// static/js/upvote-client.js
// Client-side upvote handler (runs in the reader's browser).
//
// - The server is the source of truth. The UI updates optimistically on click
//   and is rolled back if the vote is not confirmed.
// - The count stays hidden until the server has reported it, so a stale "0" is
//   never shown. No optimistic +1 happens while the count is unknown.
// - Errors are shown in the button label for a few seconds (works on touch
//   screens, where tooltips do not) and announced to screen readers via
//   .upvote-status. The button is disabled while the error is showing.
// - The anonymous voter token and the "already upvoted" flag live in
//   localStorage, with an in-memory fallback when storage is unavailable.
// - The honeypot field is pre-filled by the template and cleared on real user
//   interaction; bots that never interact send it filled and are rejected.
(function () {
  'use strict';

  const DWELL_MS = 1500; // votes are sent no earlier than this after page load
  const MESSAGE_MS = 3000; // how long an error shows (the button is disabled meanwhile)
  const STATUS_MS = 5000; // how long the screen-reader message stays in the DOM
  const TOKEN_RE = /^vtr_[a-f0-9]{32}$/;

  const TEXT = {
    idle: 'Upvote this article',
    voted: 'You upvoted this article',
    // label: shown inside the button; message: announced to screen readers only
    limited: { label: 'Try again later', message: 'Please try again later.' },
    failed: { label: 'Upvote failed', message: 'Please try again later.' },
  };

  // localStorage that never throws (Safari private mode, blocked storage, ...).
  const store = (() => {
    const mem = {};
    return {
      get(key) {
        try {
          const v = window.localStorage.getItem(key);
          if (v !== null) return v;
        } catch (_) {
          /* fall through to memory */
        }
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      set(key, value) {
        mem[key] = value;
        try {
          window.localStorage.setItem(key, value);
        } catch (_) {
          /* memory fallback only */
        }
      },
      remove(key) {
        delete mem[key];
        try {
          window.localStorage.removeItem(key);
        } catch (_) {
          /* ignore */
        }
      },
    };
  })();

  function randomHex(byteCount) {
    const bytes = new Uint8Array(byteCount);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Persistent anonymous device token: "vtr_" + 32 hex chars (the format the
  // server validates). Anything stored in an older format is replaced.
  function getVoterToken() {
    let token = store.get('voter_token');
    if (!token || !TOKEN_RE.test(token)) {
      token = 'vtr_' + randomHex(16);
      store.set('voter_token', token);
    }
    return token;
  }

  function initUpvote() {
    const form = document.getElementById('upvote-form');
    const btn = document.getElementById('upvote-btn');
    const countEl = document.getElementById('upvote-count');
    if (!form || !btn || !countEl) return;

    const postId = form.dataset.id;
    const apiUrl = form.dataset.api;
    if (!postId || !apiUrl) {
      console.warn('upvote: missing data-id or data-api on #upvote-form');
      return;
    }

    const labelEl = btn.querySelector('.upvote-label');
    const statusEl = form.querySelector('.upvote-status');
    const idleLabelText = labelEl ? labelEl.textContent : '';

    const storageKey = 'upvoted_' + postId;
    const honeypot = form.querySelector('input[name="title"]');
    const voterToken = getVoterToken();
    const pageLoadTime = Date.now();

    let inFlight = false; // a vote request is pending
    let votedThisSession = false; // the server confirmed a vote in this page view
    let currentCount = null; // null until the server has told us
    let cooldown = false; // an error is showing; the button is disabled
    let messageTimer = null;
    let statusTimer = null;

    // ---- count ------------------------------------------------------------
    // data-state drives the CSS: loading (hidden, space reserved), ready,
    // unavailable (hidden, no space).
    function renderCount(n) {
      currentCount = n;
      countEl.textContent = String(n);
      countEl.dataset.state = 'ready';
    }
    function markCountUnavailable() {
      if (currentCount === null) countEl.dataset.state = 'unavailable';
    }
    countEl.textContent = '';
    countEl.dataset.state = 'loading';

    // ---- label / tooltip / screen-reader text ------------------------------
    // Keep the custom tooltip text in sync if it is currently showing.
    function syncVisibleTooltip(text) {
      const tooltipEl = document.querySelector('.custom-tooltip');
      if (tooltipEl && tooltipEl.classList.contains('visible')) tooltipEl.textContent = text;
    }

    function setLabel(text) {
      btn.setAttribute('data-title', text);
      btn.setAttribute('aria-label', text);
      btn.removeAttribute('title');
      syncVisibleTooltip(text);
    }

    function setStatus(text) {
      if (!statusEl) return;
      clearTimeout(statusTimer);
      statusEl.textContent = text;
      statusTimer = setTimeout(() => {
        statusEl.textContent = '';
      }, STATUS_MS);
    }

    function setUpvotedState(isUpvoted) {
      if (isUpvoted) {
        btn.classList.add('upvoted');
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-disabled', 'true');
        setLabel(TEXT.voted);
      } else {
        btn.classList.remove('upvoted');
        btn.removeAttribute('aria-pressed');
        if (cooldown) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
        setLabel(TEXT.idle);
      }
    }

    // Show an error inside the button for a few seconds and announce it to
    // screen readers. The tooltip is left alone. The button is disabled
    // (aria-disabled keeps keyboard focus) so it cannot be spammed meanwhile.
    function showError(err) {
      clearTimeout(messageTimer);
      cooldown = true;
      btn.setAttribute('aria-disabled', 'true');
      if (labelEl) labelEl.textContent = err.label;
      setStatus(err.message);
      messageTimer = setTimeout(clearError, MESSAGE_MS);
    }

    function clearError() {
      clearTimeout(messageTimer);
      cooldown = false;
      if (labelEl) labelEl.textContent = idleLabelText;
      if (!btn.classList.contains('upvoted')) btn.removeAttribute('aria-disabled');
    }

    // ---- honeypot ----------------------------------------------------------
    // Cleared only by real user interaction.
    const clearHoneypot = () => {
      if (honeypot) honeypot.value = '';
    };
    ['mousemove', 'touchstart', 'keydown', 'pointerdown'].forEach((evt) =>
      window.addEventListener(evt, clearHoneypot, { once: true, passive: true })
    );

    // Instant UI from the local flag; the server reconciles it below.
    setUpvotedState(store.get(storageKey) === 'true');

    // ---- initial load ------------------------------------------------------
    // Fetch the live count and reconcile with the server. Non-blocking.
    function loadState() {
      const url =
        apiUrl +
        '?id=' +
        encodeURIComponent(postId) +
        '&voterToken=' +
        encodeURIComponent(voterToken);

      fetch(url, { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // This response may have been computed before the user's vote. Once a
          // vote is in flight or confirmed, the POST result owns the UI.
          if (inFlight || votedThisSession) return;

          if (!data || typeof data.count !== 'number') {
            markCountUnavailable();
            return;
          }
          renderCount(data.count);

          if (data.hasVoted) {
            store.set(storageKey, 'true');
            setUpvotedState(true);
          } else {
            store.remove(storageKey);
            setUpvotedState(false);
          }
        })
        .catch(() => {
          // Offline or API unavailable: keep whatever the UI shows.
          if (!inFlight && !votedThisSession) markCountUnavailable();
        });
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadState, { timeout: 2000 });
    } else {
      setTimeout(loadState, 0);
    }

    // ---- voting ------------------------------------------------------------
    function rollback(previousCount, data) {
      setUpvotedState(false);
      if (data && typeof data.count === 'number') renderCount(data.count);
      else if (previousCount !== null) renderCount(previousCount);
    }

    function sendVote(previousCount) {
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: postId,
          voterToken: voterToken,
          title: honeypot ? honeypot.value : '', // must be empty
        }),
      })
        .then((res) =>
          res
            .json()
            .catch(() => null)
            .then((data) => ({ ok: res.ok, status: res.status, data }))
        )
        .then(({ ok, status, data }) => {
          inFlight = false;

          if (ok && data && data.hasVoted) {
            // 'voted' or 'duplicate' (already voted on this device): either
            // way the server has the vote. Use its authoritative count.
            if (typeof data.count === 'number') renderCount(data.count);
            votedThisSession = true;
            store.set(storageKey, 'true');
            setUpvotedState(true);
            setStatus(TEXT.voted);
            return;
          }

          rollback(previousCount, data);
          showError(status === 429 ? TEXT.limited : TEXT.failed);
        })
        .catch(() => {
          inFlight = false;
          rollback(previousCount, null);
          showError(TEXT.failed);
        });
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // Ignore script-generated clicks (element.click() from a bot). Assistive
      // technology and keyboard activation are trusted events and still work.
      if (!e.isTrusted) return;
      if (inFlight || cooldown || btn.classList.contains('upvoted')) return;

      clearHoneypot();
      inFlight = true;

      // Optimistic update. Only bump the number if we actually know it.
      const previousCount = currentCount;
      setUpvotedState(true);
      if (previousCount !== null) renderCount(previousCount + 1);

      // Dwell-time bot trap: an early click is not dropped, it is sent once
      // DWELL_MS has passed since page load.
      const wait = Math.max(0, DWELL_MS - (Date.now() - pageLoadTime));
      setTimeout(() => sendVote(previousCount), wait);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpvote, { once: true });
  } else {
    initUpvote();
  }
})();
```

What the script takes care of:

- **Instant first paint, then reconciliation.** It shows the remembered state immediately, then asks the server and corrects anything that disagrees. Requests are deferred with `requestIdleCallback`, so the page never waits on them.
- **Optimistic voting with rollback.** The click updates the button at once. If the server doesn’t confirm, the count and button go back and the button shows `Try again later` (for a `429`) or `Upvote failed` for a few seconds, disabled so it can’t be hammered.
- **No misleading numbers.** The count is hidden until the server reports it, and a click before that doesn’t invent a “+1”.
- **Stale responses are ignored.** If the initial `GET` arrives after the user has already voted, it can’t overwrite the confirmed result.
- **Three cheap speed bumps.** The honeypot field, a 1.5 second minimum between page load and the request (an early click is delayed, not dropped), and a check that the click is a real user event rather than a script calling `element.click()`.
- **Storage that can fail.** Private modes and blocked storage fall back to memory instead of breaking the page, and tokens in an unexpected format are replaced.

### The styles

Add this to your stylesheet. The custom properties have fallbacks, so it works as is, and you can map them to your own theme tokens.

```css
/* Upvote component */
.upvote-container {
  display: flex;
  justify-content: center;
  margin: 2.5rem 0 0.5rem;
}

/* Without JavaScript the button cannot work, so do not show it. */
@media (scripting: none) {
  .upvote-container {
    display: none;
  }
}

.upvote-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
  font: inherit;
  font-weight: 500;
  color: var(--color-text-secondary, #555);
  background-color: var(--color-bg-subtle, #f5f5f5);
  border: 2px solid var(--color-border, #d0d0d0);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
}

/* Hover styles only on devices that really hover. On touch screens :hover
   sticks after a tap, which would make a rolled-back vote look upvoted. */
@media (hover: hover) {
  .upvote-button:hover:not(.upvoted):not([aria-disabled="true"]) {
    color: var(--color-text, #111);
    background-color: var(--color-accent-subtle, #e8f0ff);
    border-color: var(--color-accent, #3366ff);
    transform: translateY(-1px);
  }
}

.upvote-button:focus-visible {
  outline: 2px solid var(--color-accent, #3366ff);
  outline-offset: 2px;
}

.upvote-icon svg {
  width: 18px;
  height: 18px;
  display: block;
}

.upvote-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary, #555);
  background-color: var(--color-border, #d0d0d0);
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px transparent;
  transition: all 0.15s;
}

/* Count states, set by the script via data-state:
   loading     - the server has not answered yet: invisible, space reserved
   ready       - show the number
   unavailable - the count could not be loaded: hide the chip entirely */
.upvote-count[data-state="loading"] {
  opacity: 0;
}

.upvote-count[data-state="unavailable"] {
  display: none;
}

@media (hover: hover) {
  .upvote-button:hover:not(.upvoted):not([aria-disabled="true"]) .upvote-count {
    color: var(--color-text, #111);
    background-color: var(--color-bg, #fff);
    box-shadow: inset 0 0 0 1.5px var(--color-accent, #3366ff);
  }
}

.upvote-button.upvoted .upvote-count {
  color: var(--color-text, #111);
  background-color: var(--color-bg, #fff);
  box-shadow: inset 0 0 0 1.5px var(--color-accent, #3366ff);
}

.upvote-button.upvoted {
  color: var(--color-text, #111);
  background-color: var(--color-accent-subtle, #e8f0ff);
  border-color: var(--color-accent, #3366ff);
  cursor: default;
  transform: none;
}

/* Disabled for a few seconds while an error message is showing. */
.upvote-button[aria-disabled="true"]:not(.upvoted) {
  cursor: not-allowed;
}

/* Screen-reader-only live region for vote results and errors. */
.upvote-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Honeypot: out of the layout and the accessibility tree. The extra
   .upvote-form in the selector out-ranks a global .sr-only rule, so no
   !important is needed. The script can still read its value. */
.upvote-form .upvote-honeypot {
  display: none;
}

/* Respect reduced-motion preferences. Keep this block last so it wins. */
@media (prefers-reduced-motion: reduce) {
  .upvote-button,
  .upvote-count {
    transition: none;
  }

  .upvote-button:hover:not(.upvoted):not([aria-disabled="true"]) {
    transform: none;
  }
}
```

## Step 4: Wire it into your site

The only site-specific part is producing a stable ID for each post and printing it into `data-id`, plus rendering the snippet on post pages.

### Choosing the post ID

The ID can be any string that identifies a post and never changes. The post’s path works well, for example `posts/hello-world`.

- The function strips leading and trailing slashes, so `/posts/hello-world/` and `posts/hello-world` are the same post.
- Allowed characters are letters, digits, `.`, `_`, `~` and `-`, in up to six `/`-separated segments that each start with a letter or digit, 200 characters at most. If a slug contains anything else, such as spaces or non-ASCII characters, give that post an explicit ID.
- Most generators expose the path directly. For example: `page.path` in Zola, `.RelPermalink` in Hugo, `page.url` in Jekyll and Eleventy, and `Astro.url.pathname` in Astro. Check your generator’s docs for the exact output; what matters is that it stays the same for a given post.

To survive renames, add an optional front-matter field (I call mine `uid`) and prefer it when it is set:

```text
data-id = post.uid, if set; otherwise the post's path
```

If you later rename a post’s slug, set `uid` to the **old** ID. Votes are keyed on that string, so they follow the post.

### Where to render it

Render the snippet only on post pages, after the article body, and load the script with `defer` on those same pages. If you want a per-post opt-out, a front-matter flag such as `upvote: false` that your template checks before rendering both the snippet and the `<script>` tag is enough.

## Step 5: Configure and deploy

1. In the **Cloudflare dashboard**, open **Workers & Pages**, pick your Pages project, then **Settings** and **Variables and Secrets**.
2. Add two secrets for the Production environment (and Preview, if you use preview deployments):
   - `DATABASE_URL`: the Neon connection string from Step 1.
   - `UPVOTE_SECRET`: a long random string of at least 16 characters, for example the output of `openssl rand -hex 32`. It keys the IP hashes.
3. Commit the `functions/` directory, the snippet, the script and the styles, and push. Variables are only picked up by a new deployment, so if you added them after the last deploy, trigger a redeploy.

### Testing locally

Static-site dev servers only serve files. They do not run Pages Functions, so on a plain dev server the button will hide its count and roll back any click with “Upvote failed”, which is the fail-visibly path working as intended. To exercise the real API locally, build your site and serve the output directory through Wrangler (`public` for Zola and Hugo, `_site` for Jekyll and Eleventy, `dist` for Astro):

```bash
npx wrangler pages dev public
```

Put your two variables in a `.dev.vars` file at the repository root and add that file to `.gitignore`. Point `DATABASE_URL` at a separate Neon branch so test votes never touch your real data:

```text
DATABASE_URL="postgresql://USER:PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
UPVOTE_SECRET="any-long-random-string-of-16-or-more-characters"
```

Then exercise the endpoint with `curl`:

```bash
# Read the state of a post
curl "http://localhost:8788/api/upvote-server?id=posts/hello-world&voterToken=vtr_00000000000000000000000000000001"
# => {"id":"posts/hello-world","count":0,"hasVoted":false}

# Cast a vote (the honeypot field must be empty)
curl -X POST http://localhost:8788/api/upvote-server \
  -H "Content-Type: application/json" \
  -d '{"id":"posts/hello-world","voterToken":"vtr_00000000000000000000000000000001","title":""}'
# => {"id":"posts/hello-world","count":1,"hasVoted":true,"status":"voted"}
```

Sending the same `POST` again returns `"status":"duplicate"` with the count unchanged, and a different `voterToken` counts as a new voter.

## Porting to another platform

The function uses only web-standard APIs (`fetch`, `Request`, `Response`, `crypto.subtle` and `AbortSignal.timeout`), so the logic moves anywhere that runs them. Three things are platform-specific:

- **The entry point.** The handler is `onRequest({ request, env, waitUntil })`, which is the Cloudflare Pages shape. On a plain Cloudflare Worker, wrap it:

  ```javascript
  export default {
    fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (pathname !== '/api/upvote-server') return new Response('Not found', { status: 404 });
      return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    },
  };
  ```

  On other platforms, read `DATABASE_URL` and `UPVOTE_SECRET` from wherever your host exposes environment variables and map its request object onto `request`.
- **The client IP header.** Replace `cf-connecting-ip` in `getIpHash` with the header your platform sets itself, and make sure a client can’t supply it.
- **Same origin.** The function checks that `Origin` matches its own origin and sends no CORS headers, so the page and the function must live on the same origin. If your API is on a different domain, you will need to add CORS headers and loosen that check deliberately.

The SQL runs on any Postgres 12 or newer. If you aren’t using Neon’s HTTP endpoint, replace the `query` helper with your own driver call: the statements take the same positional parameters and return the same single row, and the one-statement design works the same over a pooled connection.

## Operating it

A few queries I keep handy:

```sql
-- Top posts
SELECT id, count, updated_at FROM article_upvotes ORDER BY count DESC LIMIT 10;

-- Drift check (should return no rows)
SELECT u.id, u.count, COUNT(v.*) AS voters
FROM article_upvotes u LEFT JOIN article_voters v ON v.post_id = u.id
GROUP BY u.id, u.count HAVING u.count <> COUNT(v.*);

-- Busiest hours (look for bursts)
SELECT post_id, date_trunc('hour', created_at) AS hour, COUNT(*)
FROM article_voters GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;

-- Reset one post, for example after testing
DELETE FROM article_voters WHERE post_id = 'posts/hello-world';
UPDATE article_upvotes SET count = 0, updated_at = NOW() WHERE id = 'posts/hello-world';
```

## Limitations and hardening

This is a *soft* counter. Be clear-eyed about what it does and doesn’t stop:

- **It is not abuse-proof.** Anyone can clear `localStorage` and get a fresh voter token. The hourly caps limit what a single network can do, but they don’t stop someone rotating IP addresses. If that matters, add a rate-limiting rule at your CDN for the endpoint, and put a challenge such as [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) in front of the `POST`, verifying its token on the server before any database call. For a personal blog I decided that wasn’t worth the effort yet.
- **Tune the caps for your audience.** The caps are per network. If a post is shared inside a large office or campus, votes beyond the cap in that hour are refused with the “Try again later” message. Raise `perPostPerHour` if you expect that.
- **Arbitrary IDs create rows.** The function validates the *format* of the post ID but not that the post exists, so a script can create rows for IDs that were never real. The all-posts cap bounds how many a single network can create per hour. Checking existence would conflict with explicit IDs, since a pinned ID may no longer match a live URL, so if it ever matters, periodically delete the rows for IDs you don’t recognise from both `article_voters` and `article_upvotes`.
- **The speed bumps are only speed bumps.** The honeypot, the minimum delay and the real-click check stop naive scripts. A script driving a real browser passes all three.
- **Privacy.** No raw IP address is stored. A keyed hash of it exists only in `ip_quota`, for about two hours. The voter token is random and anonymous, but it is a persistent per-browser identifier that sits in your database next to every post that browser voted on, so it is worth a line in your privacy notes.
- **Cold starts.** On Neon’s free tier the database can scale to zero, so the first request after an idle period may take noticeably longer. The deferred, non-blocking script means readers never wait on it, but the count may appear a moment late.

## Wrapping up

The whole thing is three tables, one function and one small script, and it fails visibly at every layer. The most useful lessons were the unglamorous ones: identify devices rather than networks, treat the server as the only source of truth about whether someone voted, let the database enforce uniqueness, and keep the aggregate and the voter rows consistent in one statement instead of checking in application code. Put limits on a row that Postgres locks rather than counting rows and hoping requests arrive one at a time. And be honest about the difference between cheap speed bumps and real abuse protection, which includes deleting a feature, like the signed token I started with, when it only looks like security.

Flush!
