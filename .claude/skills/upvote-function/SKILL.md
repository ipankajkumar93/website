---
name: upvote-function
description: "Use when modifying the upvote system — the Cloudflare Pages Function, the client-side JS, the upvote template, rate limits, or database schema. This is a plan-first skill — propose changes and get human approval before editing any upvote-related file."
disable-model-invocation: true
---

# Upvote System (Pages Function)

## When to Use

- Modifying rate limits or quotas
- Changing the database schema
- Updating the upvote client-side behavior
- Fixing bugs in the upvote flow
- Changing how post IDs are derived

**This is a plan-first skill.** Always propose changes and explain their security implications before editing. Get human approval.

## Architecture

```
Browser                    Cloudflare Pages           Neon PostgreSQL
┌─────────────────┐       ┌──────────────────┐       ┌──────────────┐
│ upvote-client.js │──────▶│ upvote-server.js │──────▶│ article_     │
│ (localStorage    │  POST │ (Pages Function) │  SQL  │   upvotes    │
│  voter token)    │◀──────│                  │◀──────│ article_     │
│                  │  JSON │                  │       │   voters     │
└─────────────────┘       └──────────────────┘       │ ip_quota     │
                                                      └──────────────┘
```

## Components

| Component | File | Role |
|---|---|---|
| **Server** | `functions/api/upvote-server.js` | CF Pages Function — handles GET (state) and POST (vote) |
| **Client** | `static/js/upvote-client.js` | Browser JS — optimistic UI, voter token, honeypot clearing |
| **Template** | `templates/components/upvote.html` | Tera template — renders the upvote form with honeypot |
| **Config** | `config.toml` | `extra.enable_upvotes`, `extra.upvote_api_url`, `extra.upvote_sections` |

## Environment Variables (Names Only)

- `DATABASE_URL` — Neon PostgreSQL connection string
- `UPVOTE_SECRET` — HMAC key for IP hashing (≥16 chars, fail-closed if missing)

Set in: Cloudflare Pages → Settings → Environment variables

## Security Properties (DO NOT BREAK)

1. **Origin check** — POST handler verifies `Origin` header matches the site. No CORS headers are sent, so cross-origin POSTs are blocked by browser preflight.
2. **Honeypot** — The template pre-fills a `title` field with `{{ page.title }}`. The client clears it on real user interaction. Server rejects requests where `title` is non-empty.
3. **Dwell time** — Votes are delayed by 1.5 s (`DWELL_MS`) after page load to catch bots.
4. **Rate limiting** — Atomic SQL with per-IP quotas:
   - `perPostPerHour: 20` (per post per IP)
   - `perIpPerHour: 60` (across all posts per IP)
5. **Voter token** — Format `vtr_` + 32 hex chars. Validated by regex on both client and server.
6. **IP hashing** — IPs are HMAC-SHA256'd with `UPVOTE_SECRET` before storage. Raw IPs are never stored.
7. **Trusted events only** — Client ignores `element.click()` (untrusted events).

## Post ID Resolution

The upvote post ID is derived from:
1. `page.extra.uid` (if set) — allows slug renames without losing votes
2. `page.path` (fallback) — the Zola page path

This is set in `templates/components/upvote.html`: `{% set post_id = page.extra.uid | default(value=page.path) %}`

## Rate Limit Tunables

Located at the top of `functions/api/upvote-server.js`:

```javascript
const LIMITS = {
  perPostPerHour: 20,
  perIpPerHour: 60,
  quotaRetentionHours: 2,
  scrubProbability: 0.02,
  dbTimeoutMs: 5000,
  maxBodyBytes: 2048,
};
```

## Database Tables

- `article_upvotes` — `(id TEXT PK, count INT, updated_at TIMESTAMP)`
- `article_voters` — `(post_id TEXT, voter_token TEXT, PK(post_id, voter_token))`
- `ip_quota` — `(ip_hash TEXT, scope TEXT, window_start TIMESTAMP, n INT, PK(ip_hash, scope, window_start))`

## Before Making Changes

1. **Explain what you're changing and why**
2. **Identify which security property is affected** (if any)
3. **Show the exact code change** as a diff
4. **Wait for human approval**
5. After approval, make the change and run `zola check`
6. Note that server-side changes require a deploy (git push) to take effect

