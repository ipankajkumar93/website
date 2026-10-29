+++
draft = true # Set this to false when you're ready to publish the article to production
slug = "building-a-serverless-dependency-free-article-upvote-system-for-static-sites"
type = "post"
in_search_index = true
title = "Building a Serverless, Dependency-Free Article Upvote System for Static Sites"
description = "A clean upvoting system for articles for Zola static sites using Serverless Functions for the backend, and Neon for the database."
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
# uid = "posts/building-a-serverless-dependency-free-article-upvote-system-for-static-sites" # Optional: Set to original ID if you rename this post's slug in the future to preserve upvotes
# og_preview_img = "/images/sample-image.jpeg" # Uncomment to specify a custom OG preview image, otherwise the build script will auto-generate one.
# cover_image = "/images/sample-image.jpeg"

[taxonomies]
post_tags = ["post","upvote","zola","serverless"]
+++

Static sites are fast, cheap and hard to break, but the moment you want a live upvote counter you need somewhere to keep state. This post walks through a small upvote system I built for this site, which is generated with [Zola](https://www.getzola.org/) and hosted on [Cloudflare Pages](https://pages.cloudflare.com/). It was inspired by [Herman's Bear Blog](https://herman.bearblog.dev/) and [Betaveros's deep-dive "That Accursed Upvote Button"](https://betaveros.bearblog.dev/that-accursed-upvote-button/), which are both worth reading for the tradeoffs involved.

By the end you will have:

- two Postgres tables on [Neon](https://neon.com/),
- one Cloudflare Pages Function (about 130 lines of plain JavaScript),
- one Tera partial, one small client script and a bit of CSS.

The code in this post is complete. Every snippet names the file it goes in, but those names are only suggestions. Put things wherever your project layout prefers, and adjust the paths in the `<script>` tag and `data-api` attribute to match.

**What you need:** a Zola site deployed to Cloudflare Pages from a Git repository, and a free Neon account.

## How it fits together

```
┌────────────────────────────────────────────────────────┐
│                      Browser                           │
│  • Anonymous voter token kept in localStorage          │
│  • Script deferred until the main thread is idle       │
│  • Optimistic UI, reconciled against the server        │
└───────────────────────▲────────────────────────────────┘
                        │ fetch() GET / POST  (same origin)
┌───────────────────────▼────────────────────────────────┐
│       Cloudflare Pages Function  /api/upvote           │
│  • No npm packages, no package.json                    │
│  • Signs and verifies short-lived HMAC tokens          │
│  • Hashes IPs, validates input, runs SQL over HTTPS    │
└───────────────────────▲────────────────────────────────┘
                        │ HTTPS  (Neon SQL-over-HTTP)
┌───────────────────────▼────────────────────────────────┐
│                Neon serverless Postgres                │
│  • article_upvotes: one aggregate count per post       │
│  • article_voters:  one row per vote                   │
└────────────────────────────────────────────────────────┘
```

### Design goals

1. **No dependencies in the shipped code.** Plain JavaScript using `fetch()`, `crypto.subtle` and `localStorage`. (You may still want [Wrangler](https://developers.cloudflare.com/workers/wrangler/) as a local dev tool, covered below.)
2. **Fail soft.** If the database is down or unconfigured, the button renders with a count of `0` and never locks the reader out.
3. **Per-device votes, not per-network.** One vote must not lock out everyone behind the same router.
4. **Survive slug renames.** Renaming a post must not orphan its votes.

## Four design decisions worth explaining

### 1. Identify voters with a token, not an IP address

The obvious first approach is to store the visitor's IP and refuse a second vote from it. The problem is NAT: every device behind one router, from a family's phones to hundreds of people in an office or on a campus, presents the same public IP. One upvote then locks out the whole network.

Instead, the browser generates a random anonymous `voter_token` and keeps it in `localStorage`. The database enforces one vote per `(post_id, voter_token)` pair, so a laptop and a phone on the same Wi-Fi can each vote once.

The IP is not thrown away, though. The server stores a salted hash of it next to each vote and uses it for one narrow purpose: a generous per-IP cap, as a fallback against scripted voting (see [Limitations](#limitations-and-hardening)). The cap is deliberately high, so a shared network can still have many legitimate voters.

The tradeoff is that clearing site data gives you a fresh identity. For a blog upvote button I think that is acceptable.

### 2. Sign the vote request, and be honest about what that buys you

When the page loads, the client calls `GET /api/upvote` and the server returns a token of the form `<timestamp>.<signature>`, where:

```
signature = HMAC-SHA256(secret, postId + ":" + timestamp + ":" + voterToken)
```

On `POST`, the server recomputes the signature from the submitted `id` and `voterToken`, and also checks that the token is neither too old (over 1 hour) nor too new (under 1.5 seconds).

What this gives you:

- A `POST` can't be pointed at a different post than the `GET` that produced its token.
- Replaying an old token stops working after an hour.
- Naive scripts that fire a `POST` instantly are rejected by the minimum-age check.

What it does **not** give you is protection against someone who deliberately scripts the whole flow: `GET` a token, wait two seconds, `POST`, repeat with a fresh `voter_token` each time. The signature stops tampering with a request in flight, not abuse by a determined client. The per-IP cap raises the cost of that, and a rate limit or Turnstile in front of the endpoint raises it further (see below).

### 3. Only trust the server about whether you voted

An optimistic UI is nice, but it creates a nasty failure mode. Suppose the click handler writes `upvoted = true` to `localStorage` and the request then fails. On every later visit the button is stuck in its "voted" state while the count shows `0`.

The rule I use: `localStorage` is only a cache for the first paint. It is written only after the server confirms the vote (`dbStatus === "online"` and `hasVoted === true`), and it is deleted whenever a later `GET` says otherwise. If the database is offline, or you are running `zola serve` and the API returns a 404, the cache is cleared and the reader can vote again once things work.

### 4. Use aria-disabled, not disabled, after voting

A native `disabled` button is removed from the tab order and, in several browsers, stops firing mouse events, so hover feedback such as a tooltip changing from "Upvote this article" to "You upvoted this article" silently stops working. `aria-disabled="true"` plus a CSS class keeps the button focusable and hoverable, and screen readers still announce it as unavailable. The click handler simply returns early.

## Step 1: Create the database tables

Create a free project in Neon, open **SQL Editor** and run:

```sql
-- 1. Table: article_upvotes
-- Stores the aggregated upvote count for each post/article.
-- Provides fast O(1) reads without expensive COUNT(*) table scans.
CREATE TABLE IF NOT EXISTS article_upvotes (
    id VARCHAR(255) PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Table: article_voters
-- Stores anonymous voter tokens and hashed IP addresses to prevent duplicate voting.
-- Neither raw IP addresses nor personal data are stored, preserving visitor privacy.
CREATE TABLE IF NOT EXISTS article_voters (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(255) NOT NULL,
    voter_token VARCHAR(64) NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_article_voter UNIQUE (post_id, voter_token)
);

-- Index for fast lookup by post and voter token
CREATE INDEX IF NOT EXISTS idx_article_voters_post_token
    ON article_voters (post_id, voter_token);

-- Index for fast lookup by post and IP hash (fallback / rate limiting)
CREATE INDEX IF NOT EXISTS idx_article_voters_post_ip
    ON article_voters (post_id, ip_hash);
```

How the pieces work together:

- **`article_upvotes`** holds one row per post with its running total, so rendering the count is a single primary-key lookup rather than a `COUNT(*)` over every vote.
- **`article_voters`** holds one row per vote. The `uq_article_voter` constraint is what actually prevents a device from voting twice on the same post.
- **`ip_hash`** is a keyed hash of the visitor's IP, not the IP itself. It is `NOT NULL`, so the function must always supply one. The `(post_id, ip_hash)` index exists to make the per-IP cap query cheap.
- Because the count lives in a separate table from the votes, the two have to be updated together. The function in Step 2 does that in a single SQL statement, so they can't drift apart.

One small note: Postgres already creates an index to enforce the `UNIQUE (post_id, voter_token)` constraint, so `idx_article_voters_post_token` duplicates it. It is harmless, and you can drop it if you want to save a little write overhead.

Then copy your connection string from the Neon dashboard (**Connect** → copy the connection string). It looks like this:

```text
postgresql://USER:PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

## Step 2: The Pages Function

Cloudflare Pages deploys any file under a top-level `functions/` directory (next to your Zola output, at the root of the repository) as a serverless function. The file path becomes the route, so `functions/api/upvote.js` serves `/api/upvote`.

```javascript
// functions/api/upvote.js

// functions/api/upvote-server.js
// Cloudflare Pages Function (Native Web Standards, zero dependencies, no package.json needed)
// Deployed automatically by Cloudflare Pages when you push to git.
//
// Environment Variables (Configured in Cloudflare Pages Dashboard -> Settings -> Environment Variables):
//   DATABASE_URL   = postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require
//   UPVOTE_SECRET  = (optional) random secret key for HMAC anti-tampering verification

// Helper: HMAC-SHA256 signature using native Web Crypto API (supported in Cloudflare Workers)
async function generateHmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper: Privacy-preserving IP hash
async function getIpHash(request, secret) {
  const ip = request.headers.get('cf-connecting-ip') ||
             request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
             '127.0.0.1';
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(ip + secret));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 24);
}

// Helper: Execute SQL via Neon HTTP API with native fetch (zero npm packages needed)
// Compatible with both direct Neon and Vercel Postgres (powered by Neon)
async function queryNeon(databaseUrl, query, params = []) {
  try {
    const urlObj = new URL(databaseUrl.replace(/^postgres(ql)?:\/\//, 'https://'));
    // Strip TCP port (e.g. :5432) and '-pooler' prefix to target Neon's direct HTTPS endpoint
    const host = urlObj.hostname.replace('-pooler', '');
    const neonHttpUrl = `https://${host}/sql`;

    const res = await fetch(neonHttpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': databaseUrl,
      },
      body: JSON.stringify({ query, params }),
    });

    if (!res.ok) {
      throw new Error(`Neon HTTP error: ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    console.warn('Neon HTTP query failed:', err.message);
    return null;
  }
}

// Main Cloudflare Pages Function entrypoint
export async function onRequest(context) {
  const { request, env } = context;
  const secret = env.UPVOTE_SECRET || 'upvote-secret-salt-2026';
  const databaseUrl = env.DATABASE_URL;

  // Standard CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const rawId = url.searchParams.get('id') || '';
  const voterTokenFromQuery = url.searchParams.get('voterToken') || '';

  // --------------------------------------------------------------------------
  // GET: Fetch live count & issue anti-tampering signed token
  // --------------------------------------------------------------------------
  if (request.method === 'GET') {
    if (!rawId || rawId.length > 255) {
      return new Response(JSON.stringify({ error: 'Valid post ID required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const postId = rawId.trim().replace(/^\/+|\/+$/g, '');
    const ipHash = await getIpHash(request, secret);
    const voterToken = voterTokenFromQuery.slice(0, 64) || `anon_${ipHash}`;

    // Issue cryptographic anti-tampering token:
    // Binds this exact postId + timestamp + voterToken with secret HMAC
    const now = Date.now();
    const tokenPayload = `${postId}:${now}:${voterToken}`;
    const signature = await generateHmac(secret, tokenPayload);
    const token = `${now}.${signature}`;

    // Failsafe: if database is not yet configured or offline
    if (!databaseUrl) {
      return new Response(
        JSON.stringify({
          id: postId,
          count: 0,
          hasVoted: false,
          token: token,
          dbStatus: 'offline',
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Query Neon via HTTP (check hasVoted by voter_token so different devices on same Wi-Fi can vote)
    const sql = `
      SELECT 
        COALESCE((SELECT count FROM article_upvotes WHERE id = $1), 0) AS count,
        EXISTS(
          SELECT 1 FROM article_voters 
          WHERE post_id = $1 AND voter_token = $2
        ) AS "hasVoted"
    `;
    const dbResult = await queryNeon(databaseUrl, sql, [postId, voterToken]);

    let count = 0;
    let hasVoted = false;

    if (dbResult && dbResult.rows && dbResult.rows.length > 0) {
      count = parseInt(dbResult.rows[0].count, 10) || 0;
      hasVoted = Boolean(dbResult.rows[0].hasVoted);
    }

    return new Response(
      JSON.stringify({
        id: postId,
        count: count,
        hasVoted: hasVoted,
        token: token,
        dbStatus: dbResult ? 'online' : 'unreachable',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  // --------------------------------------------------------------------------
  // POST: Record an upvote with strict anti-tampering verification
  // --------------------------------------------------------------------------
  if (request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // Bot Defense 1: Honeypot check (title must be empty)
    if (body.title) {
      return new Response(JSON.stringify({ error: 'Bot detected' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const postId = (body.id || '').trim().replace(/^\/+|\/+$/g, '');
    if (!postId || postId.length > 255) {
      return new Response(JSON.stringify({ error: 'Valid post ID required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const ipHash = await getIpHash(request, secret);
    const voterToken = (body.voterToken || '').slice(0, 64) || `anon_${ipHash}`;

    // ------------------------------------------------------------------------
    // ANTI-TAMPERING VERIFICATION:
    // Verify that nobody intercepted the request and changed the post ID!
    // ------------------------------------------------------------------------
    const token = body.token || '';
    if (token) {
      const [tokenTimeStr, clientSignature] = token.split('.');
      const tokenTime = parseInt(tokenTimeStr, 10);

      // Check token expiration (valid for 1 hour)
      if (isNaN(tokenTime) || Date.now() - tokenTime > 3600000) {
        return new Response(JSON.stringify({ error: 'Token expired. Please refresh the page.' }), {
          status: 403,
          headers: corsHeaders,
        });
      }

      // Recompute expected HMAC for the received postId
      const expectedPayload = `${postId}:${tokenTime}:${voterToken}`;
      const expectedSignature = await generateHmac(secret, expectedPayload);

      // If an attacker altered postId, the signatures will NOT match!
      if (expectedSignature !== clientSignature) {
        return new Response(
          JSON.stringify({ error: 'Security verification failed: Post ID tampering detected' }),
          { status: 403, headers: corsHeaders }
        );
      }
    }

    // Failsafe: if database is not configured
    if (!databaseUrl) {
      return new Response(
        JSON.stringify({
          id: postId,
          count: 1,
          hasVoted: false,
          dbStatus: 'offline',
          message: 'Upvoted locally (Database not yet configured)',
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 1. Check if this specific device/voter token already voted
    const checkSql = `
      SELECT 1 FROM article_voters 
      WHERE post_id = $1 AND voter_token = $2 
      LIMIT 1
    `;
    const checkRes = await queryNeon(databaseUrl, checkSql, [postId, voterToken]);

    if (checkRes && checkRes.rows && checkRes.rows.length > 0) {
      const countSql = `SELECT count FROM article_upvotes WHERE id = $1`;
      const countRes = await queryNeon(databaseUrl, countSql, [postId]);
      const current = countRes?.rows?.[0]?.count ? parseInt(countRes.rows[0].count, 10) : 0;
      return new Response(
        JSON.stringify({
          id: postId,
          count: current,
          hasVoted: true,
          dbStatus: 'online',
          message: 'Already upvoted on this device',
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 2. Record this unique device's vote
    await queryNeon(databaseUrl, `INSERT INTO article_voters (post_id, voter_token, ip_hash) VALUES ($1, $2, $3)`, [
      postId,
      voterToken,
      ipHash,
    ]);

    // 3. Increment count
    const updateSql = `
      INSERT INTO article_upvotes (id, count, updated_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (id) DO UPDATE 
      SET count = article_upvotes.count + 1, updated_at = NOW()
      RETURNING count
    `;
    const updateRes = await queryNeon(databaseUrl, updateSql, [postId]);

    if (!updateRes) {
      return new Response(
        JSON.stringify({
          id: postId,
          count: 1,
          hasVoted: false,
          dbStatus: 'unreachable',
          message: 'Database temporarily unavailable',
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const finalCount = updateRes?.rows?.[0]?.count ? parseInt(updateRes.rows[0].count, 10) : 1;

    return new Response(
      JSON.stringify({
        id: postId,
        count: finalCount,
        hasVoted: true,
        dbStatus: 'online',
        message: 'Upvoted successfully',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders,
  });
}const TOKEN_TTL_MS = 60 * 60 * 1000; // tokens expire after 1 hour
const MIN_AGE_MS = 1500;             // ...and can't be used instantly
const MAX_VOTES_PER_IP_PER_HOUR = 20; // per post; generous so shared networks still work

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/; // no ":" so the signed string is unambiguous
const VOTER_RE = /^vtr_[a-f0-9]{32}$/;

const enc = new TextEncoder();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

// Depending on column types, Postgres booleans may come back as true/false or 't'/'f'.
const toBool = (v) => v === true || v === 't' || v === 'true';

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message));
  return toHex(sig); // 64 hex chars, which fits the VARCHAR(64) columns
}

const sign = (secret, postId, voter, ts) => hmacHex(secret, `${postId}:${ts}:${voter}`);

// Keyed hash of the visitor's IP. A plain SHA-256 of an IPv4 address can be brute-forced
// in seconds, so we mix in the secret. Raw IPs are never stored.
const hashIp = (secret, request) =>
  hmacHex(secret, 'ip:' + (request.headers.get('CF-Connecting-IP') ?? 'unknown'));

async function verify(secret, postId, voter, token) {
  const [tsStr, sigHex] = String(token).split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !/^[a-f0-9]{64}$/.test(sigHex ?? '')) return false;

  const age = Date.now() - ts;
  if (age < MIN_AGE_MS || age > TOKEN_TTL_MS) return false;

  // crypto.subtle.verify compares in constant time
  return crypto.subtle.verify('HMAC', await hmacKey(secret), fromHex(sigHex), enc.encode(`${postId}:${ts}:${voter}`));
}

// Run one SQL statement over Neon's HTTPS endpoint and return the rows.
async function sql(env, query, params = []) {
  const url = new URL(env.DATABASE_URL.replace(/^postgres(ql)?:/, 'https:'));
  const host = url.hostname.replace('-pooler', ''); // use the direct compute host

  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': env.DATABASE_URL,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error(`Neon HTTP ${res.status}`);
  return (await res.json()).rows;
}

const offline = (token) => json({ dbStatus: 'offline', count: 0, hasVoted: false, token });

// GET /api/upvote?id=<post id>&voterToken=<token>
// -> current count, whether this voter already voted, and a signed token for the POST
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id') ?? '';
  const voter = q.get('voterToken') ?? '';

  if (!ID_RE.test(id) || !VOTER_RE.test(voter)) return json({ error: 'bad_request' }, 400);
  if (!env.DATABASE_URL || !env.UPVOTE_SECRET) return offline(null);

  const ts = Date.now();
  const token = `${ts}.${await sign(env.UPVOTE_SECRET, id, voter, ts)}`;

  try {
    const [row] = await sql(
      env,
      `SELECT COALESCE((SELECT count FROM article_upvotes WHERE id = $1::text), 0) AS count,
              EXISTS (
                SELECT 1 FROM article_voters
                 WHERE post_id = $1::text AND voter_token = $2::text
              ) AS has_voted`,
      [id, voter]
    );
    return json({ dbStatus: 'online', count: Number(row.count), hasVoted: toBool(row.has_voted), token });
  } catch (err) {
    console.warn('upvote GET failed:', err.message);
    return offline(token);
  }
}

// POST /api/upvote   { id, voterToken, token }
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const { id, voterToken, token } = body ?? {};
  if (!ID_RE.test(id ?? '') || !VOTER_RE.test(voterToken ?? '')) return json({ error: 'bad_request' }, 400);
  if (!env.DATABASE_URL || !env.UPVOTE_SECRET) return offline(null);

  if (!(await verify(env.UPVOTE_SECRET, id, voterToken, token))) {
    return json({ error: 'invalid_token' }, 403);
  }

  const ipHash = await hashIp(env.UPVOTE_SECRET, request);

  try {
    // One atomic statement, so the voter row and the aggregate count can never disagree:
    //   recent: how many votes this IP hash cast on this post in the last hour
    //   ins:    record the vote, unless the IP is over its cap or the token already voted
    //   bump:   increment the aggregate, but only if a new vote row was actually inserted
    const [row] = await sql(
      env,
      `WITH recent AS (
         SELECT count(*) AS n
           FROM article_voters
          WHERE post_id = $1::text
            AND ip_hash = $3::text
            AND created_at > now() - interval '1 hour'
       ),
       ins AS (
         INSERT INTO article_voters (post_id, voter_token, ip_hash)
         SELECT $1::text, $2::text, $3::text
          WHERE (SELECT n FROM recent) < $4::int
         ON CONFLICT (post_id, voter_token) DO NOTHING
         RETURNING 1
       ),
       bump AS (
         INSERT INTO article_upvotes (id, count)
         SELECT $1::text, 1 FROM ins
         ON CONFLICT (id) DO UPDATE
            SET count = article_upvotes.count + 1, updated_at = NOW()
         RETURNING count
       )
       SELECT COALESCE(
                (SELECT count FROM bump),
                (SELECT count FROM article_upvotes WHERE id = $1::text),
                0
              ) AS count,
              (
                EXISTS (SELECT 1 FROM ins)
                OR EXISTS (
                  SELECT 1 FROM article_voters
                   WHERE post_id = $1::text AND voter_token = $2::text
                )
              ) AS has_voted`,
      [id, voterToken, ipHash, MAX_VOTES_PER_IP_PER_HOUR]
    );

    // has_voted is false only when the IP cap blocked a brand-new voter.
    if (!toBool(row.has_voted)) return json({ dbStatus: 'online', error: 'rate_limited' }, 429);

    return json({ dbStatus: 'online', count: Number(row.count), hasVoted: true });
  } catch (err) {
    console.warn('upvote POST failed:', err.message);
    return offline(null);
  }
}
```

A few notes on this file:

- **Why SQL over HTTP?** A Worker can't keep a pooled TCP connection around between requests, and an HTTP call is one round trip with nothing to open or close. This is the same endpoint Neon's official `@neondatabase/serverless` driver uses internally. It isn't presented as a stable public REST API, though, so if you're happy to take a dependency, the official driver is the supported route.
- **One statement, two tables.** Data-modifying CTEs in Postgres all run within the same statement, which is atomic. `bump` reads from `ins`, so the aggregate is incremented only when a new vote row was really inserted. A repeated vote, or a concurrent duplicate, inserts nothing and changes nothing.
- **Duplicates are handled by the database.** `ON CONFLICT (post_id, voter_token) DO NOTHING` uses the `uq_article_voter` constraint, so there is no race between a "has this person voted?" check and the insert.
- **Input is validated before it touches SQL.** All values are passed as bind parameters, and the post ID is additionally restricted to a conservative character set.
- **Salting the IP hash.** `CF-Connecting-IP` is the header Cloudflare sets with the client address. Rotating `UPVOTE_SECRET` changes every hash, which only resets the per-IP cap window and doesn't affect stored votes.

## Step 3: The button

### The markup

Create a Tera partial. I keep mine at `templates/partials/upvote.html`.

Zola normalises `page.path` to something like `/posts/hello-world/`, with a leading and trailing slash. I trim those so the ID is a clean `posts/hello-world`, which is also the format you would use for a `uid` override.

{% raw %}
```jinja2
{% set normalized = page.path | trim_start_matches(pat="/") | trim_end_matches(pat="/") %}
{% set post_id = page.extra.uid | default(value=normalized) %}

<div class="upvote" id="upvote" data-id="{{ post_id }}" data-api="{{ config.extra.upvote_api_url | default(value='/api/upvote') }}">
  <button type="button" class="upvote-button" id="upvote-btn" aria-disabled="false" title="Upvote this article">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>
    </svg>
    <span class="upvote-label">Upvote</span>
    <span class="upvote-count" id="upvote-count" aria-live="polite">0</span>
  </button>
</div>
```
{% endraw %}

### The client script

Save this as `static/js/upvote.js` (Zola copies `static/` to the site root, so it is served at `/js/upvote.js`).

```javascript
(function () {
  function initUpvote() {
    const form = document.getElementById('upvote-form');
    const btn = document.getElementById('upvote-btn');
    const countEl = document.getElementById('upvote-count');
    if (!form || !btn || !countEl) return;

    const postId = form.dataset.id;
    const apiUrl = form.dataset.api;
    const storageKey = 'upvoted_' + postId;
    const honeypot = form.querySelector('input[name="title"]');

    const pageLoadTime = Date.now();
    let serverToken = ''; // Signed cryptographic token to prevent post ID tampering

    // Helper: Update button state and custom tooltip data-title
    function setUpvotedState(isUpvoted) {
      if (isUpvoted) {
        btn.classList.add('upvoted');
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('data-title', 'You upvoted this article');
        btn.setAttribute('aria-label', 'You upvoted this article');
        btn.removeAttribute('title');
      } else {
        btn.classList.remove('upvoted');
        btn.removeAttribute('aria-pressed');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('data-title', 'Upvote this article');
        btn.setAttribute('aria-label', 'Upvote this article');
        btn.removeAttribute('title');
      }
    }

    // 1. Get or generate persistent anonymous voter token (device-level, VPN/IP-independent)
    function getVoterToken() {
      let token = localStorage.getItem('voter_token');
      if (!token) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          token = 'vtr_' + window.crypto.randomUUID().replace(/-/g, '');
        } else {
          token = 'vtr_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        }
        localStorage.setItem('voter_token', token);
      }
      return token;
    }

    const voterToken = getVoterToken();

    // 2. Anti-bot honeypot: clear honeypot field only on real human user interaction
    const clearHoneypot = () => {
      if (honeypot) honeypot.value = '';
    };
    window.addEventListener('mousemove', clearHoneypot, { once: true });
    window.addEventListener('touchstart', clearHoneypot, { once: true });
    window.addEventListener('keydown', clearHoneypot, { once: true });

    // 3. Instant UI feedback from localStorage:
    if (localStorage.getItem(storageKey) === 'true') {
      setUpvotedState(true);
    } else {
      setUpvotedState(false);
    }

    // 4. Asynchronously fetch live count and reconcile state with PostgreSQL
    if (apiUrl) {
      const fetchUrl = `${apiUrl}?id=${encodeURIComponent(postId)}&voterToken=${encodeURIComponent(voterToken)}`;
      fetch(fetchUrl)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;

          // Save signed security token for tampering prevention
          if (data.token) {
            serverToken = data.token;
          }

          // Always display latest fresh count from database
          if (typeof data.count === 'number') {
            countEl.textContent = data.count;
          }

          // Reconcile with authoritative database:
          if (data.dbStatus === 'online') {
            if (data.hasVoted) {
              localStorage.setItem(storageKey, 'true');
              setUpvotedState(true);
            } else {
              localStorage.removeItem(storageKey);
              setUpvotedState(false);
            }
          } else {
            // DB is offline or not configured: do not lock in localStorage
            localStorage.removeItem(storageKey);
            setUpvotedState(false);
          }
        })
        .catch(() => {
          // If offline or local zola serve (404), do not permanently lock the button
          localStorage.removeItem(storageKey);
          setUpvotedState(false);
          if (countEl.textContent === '—') {
            countEl.textContent = '0';
          }
        });
    }

    // 5. Handle upvote interaction
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('upvoted')) return;

      // Dwell-time check: ignore clicks occurring within 1.5 seconds of page load (bot trap)
      if (Date.now() - pageLoadTime < 1500) return;

      // Optimistic UI update for current session
      setUpvotedState(true);

      // Update custom tooltip immediately if currently visible while hovering
      const tooltipEl = document.querySelector('.custom-tooltip');
      if (tooltipEl && tooltipEl.classList.contains('visible')) {
        tooltipEl.textContent = 'You upvoted this article';
      }

      const currentCount = parseInt(countEl.textContent, 10) || 0;
      countEl.textContent = currentCount + 1;

      // Dispatch vote to backend with tamper-proof signed token
      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: postId,
          voterToken: voterToken,
          token: serverToken, // Anti-tampering token issued on GET
          title: honeypot ? honeypot.value : '', // Honeypot: must be empty
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.count === 'number') {
            countEl.textContent = data.count;
          }

          // Only commit permanently to localStorage if DB actually saved it!
          if (data && data.dbStatus === 'online' && data.hasVoted) {
            localStorage.setItem(storageKey, 'true');
            setUpvotedState(true);
          } else {
            // DB is offline/unreachable: do not lock in localStorage
            localStorage.removeItem(storageKey);
          }
        })
        .catch(() => {
          // Network failed or local 404: do not lock in localStorage
          localStorage.removeItem(storageKey);
        });
    });
  }

  // Defer execution until browser has completed initial rendering
  if ('requestIdleCallback' in window) {
    requestIdleCallback(initUpvote);
  } else if (document.readyState === 'complete') {
    initUpvote();
  } else {
    window.addEventListener('load', initUpvote);
  }
})();
```

### The styles

Add this to your stylesheet. The custom properties have fallbacks, so it works as is, and you can map them to your own theme tokens.

```css
.upvote-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
  font: inherit;
  font-weight: 500;
  color: var(--color-text-secondary, #555);
  background: var(--color-bg-subtle, #f5f5f5);
  border: 2px solid var(--color-border, #d0d0d0);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
}

.upvote-button:hover:not(.upvoted),
.upvote-button.upvoted {
  color: var(--color-text, #111);
  background: var(--color-accent-subtle, #e8f0ff);
  border-color: var(--color-accent, #3366ff);
}

.upvote-button:hover:not(.upvoted) { transform: translateY(-1px); }
.upvote-button.upvoted { cursor: default; }

.upvote-count {
  min-width: 1.6em;
  padding: 0 0.4em;
  text-align: center;
  font-size: 0.85em;
  border-radius: 999px;
  background: var(--color-bg, #fff);
}
```

## Step 4: Wire it into Zola

### Site configuration

In `config.toml`:

```toml
[extra]
enable_upvotes = true
upvote_sections = ["posts"]        # top-level sections that get the button
upvote_api_url = "/api/upvote"
```

### Per-article control

Every article can opt out (or opt in) from its front matter, and can pin its vote ID:

```toml
[extra]
upvote = true               # false hides the button and skips loading the script
# uid = "posts/hello-world" # keep the original ID if you ever rename the slug
```

If you rename a post's slug, uncomment `uid` and set it to the **old** ID (the path without leading and trailing slashes). Votes are keyed on that string, so they follow the post.

### Page template

The button shows up when upvotes are enabled globally, the page is inside one of the configured sections, and the article hasn't opted out. In `templates/page.html`:

{% raw %}
```jinja2
{% set_global show_upvote = false %}
{% if config.extra.enable_upvotes | default(value=false) %}
  {% for section in config.extra.upvote_sections | default(value=[]) %}
    {% if section in page.components %}
      {% set_global show_upvote = true %}
    {% endif %}
  {% endfor %}
  {% if page.extra.upvote is defined %}
    {% set_global show_upvote = page.extra.upvote %}
  {% endif %}
{% endif %}

{# ...wherever the button should appear, e.g. after {{ page.content | safe }}: #}
{% if show_upvote %}
  {% include "partials/upvote.html" %}
{% endif %}

{# ...and near the end of the page: #}
{% if show_upvote %}
  <script src="{{ get_url(path='js/upvote.js', cachebust=true) | safe }}" defer></script>
{% endif %}
```
{% endraw %}

Two Tera details that tripped me up:

- Variables assigned with `set_global` inside a `for` or `if` block are visible after it; plain `set` is scoped to the block. I initialise with `set_global` as well, because mixing `set` and `set_global` for the same name can leave you reading a stale local value.
- Tera has no `?.` operator. Check optional front matter with `is defined`.

## Step 5: Configure and deploy

1. In the **Cloudflare dashboard**, open **Workers & Pages**, pick your Pages project, then **Settings** → **Variables and Secrets**.
2. Add two secrets for the Production environment (and Preview, if you use preview deployments):
   - `DATABASE_URL`: the Neon connection string from Step 1.
   - `UPVOTE_SECRET`: a long random string, for example the output of `openssl rand -hex 32`. It signs the vote tokens and salts the IP hashes.
3. Commit the `functions/` directory, the template, the script and the styles, and push. Variables are only picked up by a new deployment, so if you added them after the last deploy, trigger a redeploy.

### Testing locally

`zola serve` only serves static files. It does not run Pages Functions, so the button will show `0` and ignore clicks (this is the fail-soft path from decision 3 working as intended). To exercise the real API locally:

```bash
zola build
npx wrangler pages dev public
```

Put your two variables in a `.dev.vars` file at the repository root and add that file to `.gitignore`:

```text
DATABASE_URL="postgresql://USER:PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
UPVOTE_SECRET="any-long-random-string"
```

You can also sanity-check the read path with `curl`:

```bash
curl "http://localhost:8788/api/upvote?id=posts/hello-world&voterToken=vtr_00000000000000000000000000000000"
```

## Limitations and hardening

This is a *soft* counter. Be clear-eyed about what it does and doesn't stop:

- **It is not abuse-proof.** Anyone can clear `localStorage` and get a fresh voter token. The per-IP cap (20 votes per post per hour in the code above) limits how far a single address can inflate a count, but it doesn't stop someone rotating IPs. If that matters, add a [Cloudflare rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) on `/api/upvote`, or put [Turnstile](https://developers.cloudflare.com/turnstile/) in front of the `POST`.
- **Tune the cap for your audience.** The cap is per IP hash, so it is also a NAT limit: if a post is shared inside a large office or campus, legitimate voters behind one address can hit it. Raise `MAX_VOTES_PER_IP_PER_HOUR` if you expect that.
- **Arbitrary IDs create rows.** The function validates the *format* of the post ID but not that the post exists, so a script can create rows for IDs that were never real. Checking existence would conflict with the `uid` override, since a pinned ID may no longer match a live URL. If it ever matters, periodically delete the rows for IDs you don't recognise from both `article_voters` and `article_upvotes`.
- **Privacy.** No raw IP address is stored, only a keyed hash. The voter token is random and anonymous, but it is a persistent per-browser identifier that sits in your database next to every post that browser voted on, so it is worth a line in your privacy notes.
- **Cold starts.** On Neon's free tier the database can scale to zero, so the first request after an idle period may take noticeably longer. The deferred, non-blocking script means readers never wait on it, but the count may appear a moment late.
- **Token lifetime.** A tab left open for more than an hour will have an expired token, and the vote is rejected and rolled back until the page is reloaded.

## Wrapping up

The whole thing is two tables, one function and one small script, and it degrades gracefully at every layer. The most useful lessons were the unglamorous ones: identify devices rather than networks, treat the server as the only source of truth about whether someone voted, let the database enforce uniqueness and keep the aggregate and the voter rows consistent in one statement instead of checking in application code, and be honest about the difference between request signing and real abuse protection.

Flush!
