---
name: seo-llms
description: "Use when updating SEO metadata, JSON-LD structured data, Open Graph tags, llms.txt or llms-full.txt generation, Atom feeds, sitemap, or the AI agent directive. Covers all machine-readable output and how each is generated."
---

# SEO & Machine-Readable Output

## When to Use

- Updating Open Graph or Twitter Card metadata
- Modifying JSON-LD structured data
- Changing how llms.txt or llms-full.txt is generated
- Adding or modifying Atom feeds
- Updating the sitemap or AI agent directive
- Adding new `<link rel="alternate">` tags

## System Overview

| Output | Source | Template/Script | Notes |
|---|---|---|---|
| **OG + Twitter tags** | `config.toml`, page front matter | `templates/og.html` (included in `base.html`) | Auto-generated for all pages |
| **JSON-LD** | Same as above | Inside `templates/og.html` | `BlogPosting` for posts/travel, `Article` for RTD, `WebSite` for others |
| **llms.txt** | `content/llms/index.md` | `templates/llms.html` → post-build rename | Index of published content with .md links |
| **llms-full.txt** | `content/llms-full/index.md` | `templates/llms-full.html` → post-build rename | Full corpus inline |
| **Markdown source** | All non-draft content | `scripts/copy_md_files.py` | Copies raw .md to `public/<slug>/<slug>.md` with UTF-8 BOM |
| **Atom feeds** | Section `_index.md` with `generate_feeds = true` | Zola built-in `atom.xml` template | Root + per-section feeds |
| **Sitemap XML** | Zola auto-generated | Built-in | `public/sitemap.xml` |
| **Sitemap HTML** | `content/sitemap/index.md` | `templates/sitemap.html` | Human-readable sitemap page |
| **AI directive** | Hardcoded in `base.html` | `<aside class="sr-only" data-ai-agent-directive>` | Routes AI to llms.txt |

## How OG/Twitter/JSON-LD Works

`templates/og.html` uses this logic:

1. **Pages in `og_sections`** (`posts`, `rtd`, `travel`): `og:type = "article"`, JSON-LD type is `BlogPosting` (posts/travel) or `Article` (RTD)
2. **Other pages**: `og:type = "website"`, JSON-LD type is `WebSite`
3. **OG image path**: auto-derived as `images/og/<page.path trimmed>.png`, or `page.extra.og_preview_img` if set
4. **Twitter card**: `summary_large_image` for pages with images, `summary` otherwise
5. **Twitter creator**: pulled from `contact/index.md` → `extra.x.url`

## How llms.txt Works

### llms.txt (index)

Template: `templates/llms.html`
- Iterates over `config.extra.featured_sections` (posts, rtd, travel)
- Lists each non-draft page with title, permalink to `.md` source, and description
- Build step renames `public/llms.txt/index.html` → `public/llms.txt`

### llms-full.txt (full corpus)

Template: `templates/llms-full.html`
- Same iteration but includes full markdown body inline
- Shortcodes (admonitions) are replaced with blockquote equivalents via Tera `replace()` filters
- Build step renames `public/llms-full.txt/index.html` → `public/llms-full.txt`

### Critical constraint

The path trick in Makefile/build.sh (`mv public/llms.txt/index.html → public/llms.txt`) MUST be preserved. If you change `content/llms/index.md` or `content/llms-full/index.md`, ensure:
- `path = "llms.txt"` / `path = "llms-full.txt"` remains in front matter
- The post-build rename step in `Makefile` and `bin/build.sh` still works

## How Markdown Source Files Work

`scripts/copy_md_files.py`:
- Copies every non-draft `content/**/index.md` to `public/<slug>/<slug>.md`
- Prepends UTF-8 BOM (`\xef\xbb\xbf`) so LLM crawlers decode correctly
- `base.html` advertises these via `<link rel="alternate" type="text/markdown">`

## Feeds

Feeds are enabled per-section in `_index.md` with `generate_feeds = true`:
- `content/posts/_index.md` → `/posts/atom.xml`
- `content/rtd/_index.md` → `/rtd/atom.xml`
- `content/travel/_index.md` → `/travel/atom.xml`
- Root feed: `/atom.xml`

Feed format is Atom (`feed_filenames = ["atom.xml"]` in `config.toml`).

## Modifying Any of These

1. **OG/Twitter/JSON-LD**: Edit `templates/og.html` — requires human approval (template file)
2. **llms.txt content**: The templates pull from `featured_sections` config — to add a section, add it to `config.extra.featured_sections`
3. **Feeds**: Add `generate_feeds = true` to a section's `_index.md`
4. **Sitemap**: Zola auto-generates — no manual changes needed
5. **AI directive**: Hardcoded in `templates/base.html` — requires human approval

