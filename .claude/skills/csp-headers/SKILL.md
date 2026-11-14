---
name: csp-headers
description: "Use when adding a new external script, font, stylesheet, iframe embed, or API origin, OR when modifying Content-Security-Policy or other security headers in static/_headers. This is a plan-first skill — propose changes and get human approval before editing."
disable-model-invocation: true
---

# CSP & Security Headers

## When to Use

- Adding a new external JavaScript library or analytics script
- Adding a new external font (e.g., Google Fonts)
- Adding a new iframe embed provider (e.g., CodePen, Vimeo)
- Adding a new API endpoint that the client-side JS connects to
- Modifying any security header in `static/_headers`

## Current Headers

File: `static/_headers`

All responses (`/*`):

| Header | Value |
|---|---|
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` |

### Current CSP Directives

| Directive | Value | What it allows |
|---|---|---|
| `default-src` | `'self'` | Only same-origin by default |
| `script-src` | `'self' 'unsafe-inline' https://static.cloudflareinsights.com https://*.cloudflareinsights.com` | Self-hosted JS + inline scripts + Cloudflare analytics |
| `style-src` | `'self' 'unsafe-inline'` | Self-hosted CSS + inline styles |
| `img-src` | `'self' data: https:` | Self-hosted + data URIs + any HTTPS image |
| `font-src` | `'self'` | Self-hosted fonts ONLY |
| `connect-src` | `'self' https:` | Self-hosted + any HTTPS API |
| `frame-src` | `https://www.youtube-nocookie.com https://www.youtube.com` | YouTube embeds only |

### Cache Headers (path-specific)

| Path | Cache-Control |
|---|---|
| `/fonts/*` | `public, max-age=31536000, immutable` |
| `/styles/*` | `public, max-age=31536000, immutable` |
| `/js/*` | `public, max-age=31536000, immutable` |
| `/images/*` | `public, max-age=2592000` |

## CSP Change Checklist

When adding a new external resource, identify which CSP directive needs updating:

| Resource Type | CSP Directive to Update | Example |
|---|---|---|
| External JS script | `script-src` | Add `https://cdn.example.com` |
| External CSS stylesheet | `style-src` | Add `https://fonts.googleapis.com` |
| External font file | `font-src` | Add `https://fonts.gstatic.com` |
| External image source | `img-src` | Already allows `https:` — no change needed |
| External API / fetch target | `connect-src` | Already allows `https:` — no change needed for HTTPS APIs |
| New iframe embed | `frame-src` | Add the embed provider's origin |
| WebSocket connection | `connect-src` | Add `wss://example.com` |

## Procedure

1. **Identify the exact origin(s)** needed (e.g., `https://cdn.jsdelivr.net`, not just `https:`)
2. **Use the narrowest possible origin** — prefer `https://specific.cdn.com` over `https://*.cdn.com` over `https:`
3. **Propose the change** with the exact new `_headers` content — do NOT apply it without human approval
4. **After approval**, edit `static/_headers` — the CSP is on a single long line (do not break it into multiple lines)
5. **Test locally** with `zola serve --drafts` and check the browser console for CSP violations
6. **Document** what was added and why in the commit message

## Important Notes

- The CSP is a **single line** in `static/_headers`. Cloudflare Pages does not support multi-line header values.
- `'unsafe-inline'` is in both `script-src` and `style-src` — this is intentional for inline theme detection and styles.
- The `connect-src 'self' https:` is intentionally permissive for HTTPS APIs (e.g., Umami analytics, upvote API).
- Adding `'unsafe-eval'` to `script-src` should be avoided. If a library requires it, find an alternative.
- YouTube embeds use `youtube-nocookie.com` for privacy. Switching to `youtube.com` is intentional for compatibility.

