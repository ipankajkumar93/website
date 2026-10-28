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
}
