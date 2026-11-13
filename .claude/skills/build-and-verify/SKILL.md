---
name: build-and-verify
description: "Use when building the site, checking for errors, verifying the build output, or checking Zola version compatibility. Covers the full build pipeline, Zola version verification, and common error patterns."
---

# Build and Verify

## When to Use

- Building the site locally
- Checking for build errors or warnings
- Verifying Zola version compatibility
- Running the full build pipeline (including OG images and llms.txt)
- Diagnosing build failures

## Zola Version Verification

**ALWAYS check the installed Zola version before building.** The project pins Zola to a specific version in `bin/build.sh`.

### Step 1: Check installed version

```bash
zola --version
```

### Step 2: Check project-pinned version

```bash
grep -o 'zola.*[0-9]\+\.[0-9]\+\.[0-9]\+' bin/build.sh | head -1
```

The version in `bin/build.sh` is the source of truth (currently `0.23.6`).

### Step 3: If versions differ

1. **Installed version is OLDER than pinned**: Warn the user. The build may fail or produce incorrect output due to missing features.
2. **Installed version is NEWER than pinned**: Check the [Zola changelog](https://github.com/getzola/zola/blob/master/CHANGELOG.md) and [Tera changelog](https://github.com/Keats/tera/blob/master/CHANGELOG.md) for breaking changes between the pinned version and the installed version. Specifically look for:
   - Deprecated template syntax, filters, or functions
   - Changed front matter field handling
   - Modified shortcode/component syntax
   - Search index format changes
   - Feed generation changes
   - Markdown rendering changes
3. **Report findings** to the user with specific changelog references before proceeding.

### Step 4: If updating the pinned version

When the user asks to update the Zola version:

1. Check the [Zola changelog](https://github.com/getzola/zola/blob/master/CHANGELOG.md) and [Tera changelog](https://github.com/Keats/tera/blob/master/CHANGELOG.md) for ALL versions between current pin and target
2. List every breaking change and deprecation
3. Search the codebase for affected patterns:
   ```bash
   # Example: search for deprecated syntax patterns
   grep -rn 'PATTERN' templates/ content/ config.toml
   ```
4. Propose code changes to fix deprecations
5. Update the version in `bin/build.sh` (both the version check and the download URL)
6. Run `zola build` and `zola check` to verify
7. Present a summary of all changes made

## Build Pipeline

### Quick build (Zola only)

```bash
zola build
```

Output: `public/` directory. Takes ~6 seconds.

### Full build (with OG images and llms.txt)

```bash
make build
```

This runs four steps in sequence:
1. `zola build` — generates HTML, CSS, JS, search index, feeds, sitemap
2. `uv run scripts/generate_og_images.py` — generates OG social preview images
3. `uv run scripts/copy_md_files.py` — copies raw .md files to public/ for LLM consumption
4. Renames `public/llms.txt/index.html` → `public/llms.txt` and same for `llms-full.txt`

### Local preview (includes drafts)

```bash
zola serve --drafts
# or
make preview
```

Server runs at `http://127.0.0.1:1111` with live reload.

### Verification checks

```bash
# Check for broken internal links and front matter errors
zola check

# Check for broken external links (requires lychee — optional)
make check-links
```

## What to Verify After Building

1. **`zola check` passes** — no orphan pages, no broken internal links
2. **`zola build` completes without warnings** — watch for:
   - "Warning: Found an internal link" (broken `@/` references)
   - "Warning: Page not found" (missing referenced pages)
   - "Warning: Taxonomy" (undefined taxonomy names)
3. **OG images generated** — check `static/images/og/` for expected PNG files
4. **llms.txt exists as flat file** — `public/llms.txt` should be a file, not a directory
5. **Grep diff for forbidden patterns (Definition of Done)**:
   ```bash
   git diff | grep -E 'style=|(<style)|on[a-z]+=|javascript:|(\bvar\b)|!important|@import|document\.write'
   ```
   Must return zero matches. If any forbidden patterns exist, refactor to follow code standards.
6. **CSP & Security check**: If any external origin was added, ensure `static/_headers` was updated and approved.
7. **Color contrast check**: If CSS changed, verify WCAG AA contrast (4.5:1 body, 3:1 UI/headings) in both light and dark themes.
8. **Mobile mode & responsive check**:
   - The site's primary mobile breakpoint is `@media screen and (max-width: 1024.98px)` (desktop starts at `min-width: 1025px`).
   - Narrow screen ladder: `768px`, `600px`, and `480px`.
   - Verify any UI change down to `360px` viewport width.
   - Confirm zero horizontal page scroll (`overflow-x: hidden`), proper text wrapping, and touch targets >= 44×44px.

## Common Error Patterns

| Error | Cause | Fix |
|---|---|---|
| `Failed to parse front matter` | Quoted date (`"2026-06-14"`) or missing `+++` | Use bare TOML date, ensure `+++` delimiters |
| `Taxonomy not found` | Using `tags` instead of `post_tags`/`rtd_tags`/`travel_tags` | Use the section-specific taxonomy name |
| `Component not found` | Wrong shortcode syntax | Use Zola 0.23 component syntax: `{% <name> %}` |
| `Image not found` | Wrong path in `get_image_metadata` | Path must be relative to project root, starting with `static/` |
| OG generation fails | Missing fonts in `scripts/fonts/` | Ensure `Roboto-Bold.ttf` and `Roboto-Regular.ttf` exist |

