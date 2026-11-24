---
name: og-images
description: "Use when generating, regenerating, or debugging OG (Open Graph) social preview images. Covers the Python/Pillow generation script, the cache system, font requirements, and the gitignore constraints."
---

# OG Image Generation

## When to Use

- Generating OG images after adding new content
- Regenerating images after changing titles or descriptions
- Debugging missing or broken social preview images
- Understanding why an OG image wasn't generated

## How It Works

The script `scripts/generate_og_images.py` (Python 3.11+ with Pillow, run via `uv`) generates 1200×630 PNG social preview images.

### What it generates

1. **Homepage image** (`static/images/og/home.png`) — from `config.toml` title and description
2. **Landing page images** (`static/images/og/<section>.png`) — for each section's `_index.md`
3. **Article images** (`static/images/og/<section>/<slug>.png`) — for each published article

### What it skips

- Articles with `draft = true`
- Articles with a custom `og_preview_img` set in front matter
- Articles whose content hash matches the cache (no title/description change)

### Cache system

- Cache file: `.og_cache.json` (project root)
- Stores content hashes keyed by output path
- If the hash matches and the output file exists, the image is skipped
- Delete `.og_cache.json` to force full regeneration

## Commands

```bash
# Generate OG images (via uv — auto-installs Pillow)
uv run scripts/generate_og_images.py

# Or via make
make og-images
```

## Configuration

The script reads from `config.toml`:

- `extra.og_sections` — which content sections get OG images (default: `["posts", "rtd", "travel"]`)
- `title` — used for the homepage image and as the author name
- `base_url` — used for the domain shown on images
- `extra.main_menu` — used to build footer text on images

## Font Requirements

The script looks for fonts at:
- `scripts/fonts/Roboto-Bold.ttf` — for titles
- `scripts/fonts/Roboto-Regular.ttf` — for descriptions and metadata

If fonts are missing, it falls back to Pillow's default font (lower quality).

## Important Constraints

1. **`static/images/og/` is gitignored** — OG images are NEVER committed to git. They are generated fresh at build time by `bin/build.sh`.
2. **The OG template (`templates/og.html`) derives image paths from `page.path`** — the path is `images/og/<trimmed-page-path>.png`. If you change a slug, the expected OG image path changes.
3. **Custom OG images** — set `og_preview_img` in front matter to use a custom image instead of auto-generated. The custom image should be in `static/images/` (not in the `og/` subdirectory).
4. **The build pipeline runs OG generation AFTER `zola build`** — because it reads front matter from `content/` to determine what to generate.

## Debugging

If a social preview image is missing or wrong:

1. Check `extra.og_sections` in `config.toml` — is the section listed?
2. Check if the article has `draft = true` — drafts are skipped
3. Check if `og_preview_img` is set — custom images bypass generation
4. Delete `.og_cache.json` and rerun `make og-images` to force regeneration
5. Check `templates/og.html` — the expected path is `images/og/<page.path trimmed>.png`

