---
name: upstream-sync
description: "Use when deciding whether a change belongs in the upstream template (zola-slate) vs a downstream site repo, or when merging upstream template updates into a downstream fork without overwriting site content."
---

# Upstream & Downstream Sync

## Repository Ownership Boundary

`zola-slate` is the **upstream template**; downstream site repos (e.g. personal website forks) inherit shared infrastructure via `git fetch` / `git merge` while protecting site-specific files with `.gitattributes` (`merge=ours`).

| Scope | Owner | Examples |
|---|---|---|
| **Upstream (`zola-slate`)** | Shared template | `templates/`, `static/styles/`, `static/js/`, `functions/`, `scripts/`, `.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `bin/`, `Makefile` |
| **Downstream (`website`)** | Protected via `.gitattributes` (`merge=ours`) | `content/**`, `static/images/**`, `config.toml` |
| **Site-specific static files** | Downstream customized | `static/_headers` (domain/analytics CSP), `static/favicon*`, `static/robots.txt`, `static/site.webmanifest` |

### Golden Rule
- Fix **shared code, templates, CSS, JS, scripts, and agent/skill docs** in `zola-slate`, then merge downstream.
- Fix **articles, pages, images, `config.toml`, and site-specific `static/_headers` origins** in the downstream repo.

---

## One-Time Downstream Setup

Ensure `.gitattributes` protects downstream-owned paths and the local merge driver is registered:

```gitattributes
content/** merge=ours
static/images/** merge=ours
config.toml merge=ours
```

```bash
git config merge.ours.driver true
```

---

## Merging Upstream Into Downstream

1. **Ensure a clean working tree** on `develop` in the downstream repo (`git status`).
2. **Fetch and merge** from the upstream remote (for example `template`):
   ```bash
   git fetch template
   git merge template/develop   # or template/master for tagged releases
   ```
3. **Check `static/_headers` conflicts carefully**:
   - Keep downstream domain & analytics origins (e.g., `https://yourdomain.com`, `https://um.yourdomain.com`).
   - Accept upstream CSP directive additions (e.g., new `frame-src` or tighter rules) using explicit `https://` scheme prefixes.
4. **Check `config.toml` & `content/_index.md` for new template features**:
   - Inspect upstream `config.toml` and `content/_index.md` diffs for any newly introduced `[extra]` keys (for example, `hero_title`, `profile_image`, `profile_alt`, `profile_avif`, `profile_webp` used by `templates/index.html`) and adopt them in the downstream `config.toml` / `content/_index.md` as needed.
5. **Check for leaked upstream sample content**:
   - If `merge=ours` only protects modified existing paths, verify no upstream-only sample bundles (such as `content/posts/test-bundle-post/`) were newly added into downstream `content/`.
6. **Rebuild & verify**:
   ```bash
   make build
   zola check
   ```
   Verify `static/images/og/` regenerates for all published posts and standalone page bundles (`contact`, `sitemap`, `topics`).
